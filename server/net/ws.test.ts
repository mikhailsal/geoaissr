import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ServerMessage } from '../../shared/protocol.ts';
import { createRoomShell } from '../engine/shell.ts';
import { createInitialRoomState } from '../engine/types.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { buildQuotaSummaryForRoom, createQuotaManager } from '../storage/quota.ts';
import { ProfileStore } from '../storage/profiles.ts';
import { startAppHttpServer } from './http.ts';
import { createAuthRateLimiter } from './rate-limit.ts';
import { createWsRoomCoordinator } from './ws.ts';

function connectWsAndCollect(
  url: string,
): Promise<{ ws: WebSocket; nextMsg: () => Promise<ServerMessage> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue: ServerMessage[] = [];
    const waiters: Array<(m: ServerMessage) => void> = [];
    ws.onmessage = (ev) => {
      const parsed = JSON.parse(String(ev.data)) as ServerMessage;
      const w = waiters.shift();
      if (w) w(parsed);
      else queue.push(parsed);
    };
    ws.onerror = () => {
      reject(new Error('WS error'));
    };
    ws.onopen = () => {
      resolve({
        ws,
        nextMsg: () => {
          const item = queue.shift();
          if (item) return Promise.resolve(item);
          return new Promise<ServerMessage>((res) => {
            waiters.push(res);
          });
        },
      });
    };
  });
}

function setupTestServer(dir: string, staticDir = path.join(dir, 'missing-dist')) {
  const quota = createQuotaManager(path.join(dir, 'quota.json'));
  const thumbs = createThumbStore();
  const initial = createInitialRoomState({
    matchId: 'ws-m1',
    fakeMode: true,
    settings: {
      version: 2,
      map: 'standard',
      region: 'world',
      rounds: 2,
      roundDurationSec: 60,
      moveEnabled: true,
      aiWaitWindowSec: 30,
      showMatchStandings: true,
      bots: [],
    },
    quotaSummary: buildQuotaSummaryForRoom(quota, { rounds: 2 }),
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [],
  });
  let coordinatorRef: ReturnType<typeof createWsRoomCoordinator> | null = null;
  const shell = createRoomShell(initial, {
    onStateChange: () => {
      coordinatorRef?.broadcastState();
    },
    saveSettings: () => {},
    confirmQuotaReset: () => Promise.resolve(initial.quotaSummary),
    prepareRound: () =>
      Promise.resolve({
        panoId: 'p1',
        lat: 55,
        lng: 37,
        countryId: '643-eu',
        countryNameRu: 'Россия',
        map: 'standard',
        region: 'world',
        fakeSceneIndex: 0,
      }),
    startBotProcesses: () => undefined,
    releaseBotObserve: () => undefined,
    stopBotProcess: () => undefined,
    stopAllBots: () => undefined,
    clearRoundImages: () => undefined,
    clearThumbs: () => {
      thumbs.clear();
    },
    appendMatchRecord: () => Promise.resolve(),
    logRoundEnd: () => undefined,
  });
  const rateLimiter = createAuthRateLimiter('local');
  const coordinator = createWsRoomCoordinator({
    shell,
    profiles: new ProfileStore(path.join(dir, 'profiles.json')),
    hostToken: 'host-secret-tok',
    guestToken: 'guest-secret-tok',
    browserMapsKey: null,
    fakeMode: true,
    quotaManager: quota,
    rateLimiter,
  });
  coordinatorRef = coordinator;
  const srv = startAppHttpServer({
    port: 0,
    staticDir,
    shell,
    thumbStore: thumbs,
    wsCoordinator: coordinator,
    rateLimiter,
  });
  return { shell, srv };
}

test('rate limiter respects CF-Connecting-IP only in tunnel mode and bans after 10 failures', () => {
  const rlTunnel = createAuthRateLimiter('tunnel');
  const req = new Request('http://localhost/ws', {
    headers: { 'cf-connecting-ip': '198.51.100.42' },
  });
  expect(rlTunnel.extractClientIp(req, '127.0.0.1')).toBe('198.51.100.42');

  const rlLocal = createAuthRateLimiter('local');
  expect(rlLocal.extractClientIp(req, '127.0.0.1')).toBe('127.0.0.1');

  for (let i = 0; i < 11; i += 1) {
    rlTunnel.recordAuthFailure('198.51.100.42', 10_000 + i);
  }
  expect(rlTunnel.isBlocked('198.51.100.42', 10_500)).toBe(true);
  expect(rlTunnel.isBlocked('198.51.100.42', 75_000)).toBe(false);
});

// Value: protects=avatar image delivery; fails_when=WebP or cache rules change; why_new=health tests load no assets; seam=none; no_claim=local HTTP does not exercise a public CDN.
test('Orbit wardrobe and stage assets serve real WebP images with revalidation', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-orbit-http-'));
  const { shell, srv } = setupTestServer(dir, path.resolve(import.meta.dir, '../../web/public'));
  try {
    for (const asset of ['/orbit/look.webp', '/orbit-stage/lunar-drift.webp']) {
      const response = await fetch(new URL(asset, srv.baseUrl));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/webp');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    }
    const sound = await fetch(new URL('/audio/swoosh.ogg', srv.baseUrl));
    expect(sound.status).toBe(200);
    expect(sound.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await sound.body?.cancel();
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WS auth rejects bad tokens, supports host join and healthz', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-ws-test-'));
  const { shell, srv } = setupTestServer(dir);
  try {
    const hz = await fetch(`${srv.baseUrl}/healthz`);
    expect(hz.status).toBe(200);
    const hzJson = (await hz.json()) as { ok: boolean; phase: string };
    expect(hzJson.ok).toBe(true);

    const badClient = await connectWsAndCollect(srv.baseUrl.replace('http://', 'ws://') + '/ws');
    badClient.ws.send(JSON.stringify({ type: 'hello', token: 'wrong-token' }));
    expect((await badClient.nextMsg()).type).toBe('hello_error');

    const hostClient = await connectWsAndCollect(srv.baseUrl.replace('http://', 'ws://') + '/ws');
    hostClient.ws.send(JSON.stringify({ type: 'hello', token: 'host-secret-tok' }));
    expect((await hostClient.nextMsg()).type).toBe('hello_ok');
    expect((await hostClient.nextMsg()).type).toBe('state');

    hostClient.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: 'Тасс', color: 'p-1' }));
    expect((await hostClient.nextMsg()).type).toBe('join_ok');
    hostClient.ws.send(JSON.stringify({ type: 'update_lobby', seq: 2, patch: { rounds: 4 } }));
    const next = await hostClient.nextMsg();
    expect(next.type === 'state' || next.type === 'ack').toBe(true);
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
