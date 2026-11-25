import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_AUDIO_PREFERENCES } from '../../shared/audio-preferences.ts';
import type { ParticipantColorId } from '../../shared/colors.ts';
import type { ClientViewState, ServerMessage } from '../../shared/protocol.ts';
import { createDefaultSettings } from '../../shared/storage-schemas.ts';
import type { BotRunner } from '../bots/runner.ts';
import { reduce } from '../engine/reduce.ts';
import { computeFinalRankings } from '../engine/results.ts';
import { createRoomShell } from '../engine/shell.ts';
import { createInitialRoomState } from '../engine/types.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { buildQuotaMetric, createQuotaManager } from '../storage/quota.ts';
import { ProfileStore } from '../storage/profiles.ts';
import { startAppHttpServer } from './http.ts';
import { createAuthRateLimiter } from './rate-limit.ts';
import { MAX_UNJOINED_AUTHENTICATED } from './ws-actions.ts';
import { createWsRoomCoordinator } from './ws.ts';

interface WsHandle {
  ws: WebSocket;
  nextMsg: (timeoutMs?: number) => Promise<ServerMessage | null>;
  waitClose: (timeoutMs?: number) => Promise<number>;
}

function connectWs(url: string): Promise<WsHandle> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue: ServerMessage[] = [];
    const waiters: Array<(m: ServerMessage | null) => void> = [];
    let closedCode: number | null = null;
    const closeWaiters: Array<(c: number) => void> = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    };
    ws.onclose = (ev) => {
      closedCode = ev.code;
      for (const cw of closeWaiters.splice(0)) cw(ev.code);
      for (const mw of waiters.splice(0)) mw(null);
    };
    ws.onerror = () => {
      reject(new Error('WS error'));
    };
    ws.onopen = () => {
      resolve({
        ws,
        nextMsg: (timeoutMs = 1500) => {
          const item = queue.shift();
          if (item) return Promise.resolve(item);
          if (closedCode !== null) return Promise.resolve(null);
          return new Promise<ServerMessage | null>((res) => {
            const t = setTimeout(() => {
              res(null);
            }, timeoutMs);
            waiters.push((m) => {
              clearTimeout(t);
              res(m);
            });
          });
        },
        waitClose: (timeoutMs = 1500) => {
          if (closedCode !== null) return Promise.resolve(closedCode);
          return new Promise<number>((res, rej) => {
            const t = setTimeout(() => {
              rej(new Error('close timeout'));
            }, timeoutMs);
            closeWaiters.push((c) => {
              clearTimeout(t);
              res(c);
            });
          });
        },
      });
    };
  });
}

function buildSecInitialState(fakeMode: boolean) {
  return createInitialRoomState({
    matchId: 'sec-m1',
    fakeMode,
    settings: {
      version: 2,
      map: 'standard',
      region: 'world',
      rounds: 2,
      roundDurationSec: 60,
      moveEnabled: true,
      aiWaitWindowSec: 30,
      showMatchStandings: true,
      pushEnabled: false,
      pushSeconds: 15,
      allowBotPush: true,
      bots: [],
    },
    quotaSummary: {
      metrics: {
        static: buildQuotaMetric(0, 8000),
        pano: buildQuotaMetric(0, 4000),
        map: buildQuotaMetric(0, 8000),
      },
      staticUsed: 0,
      staticCeiling: 8000,
      staticWorstCase: 0,
      panoUsed: 0,
      panoCeiling: 4000,
      panoWorstCase: 4,
      mapUsed: 0,
      mapCeiling: 8000,
      mapWorstCase: 4,
      needsResetConfirm: false,
      sufficient: true,
    },
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [
      { id: 'claude', available: true, readsOwnerFiles: false, models: ['haiku'] },
    ],
  });
}

function createSecServer(
  dir: string,
  mode: 'tunnel' | 'local' | 'public_url',
  fakeMode = false,
  botRunner?: BotRunner,
) {
  const quota = createQuotaManager(path.join(dir, 'quota.json'));
  const thumbs = createThumbStore();
  const initial = buildSecInitialState(fakeMode);
  let coordRef: ReturnType<typeof createWsRoomCoordinator> | null = null;
  const shell = createRoomShell(initial, {
    onStateChange: () => coordRef?.broadcastState(),
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
  const rateLimiter = createAuthRateLimiter(mode);
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  const coord = createWsRoomCoordinator({
    profiles,
    shell,
    hostToken: 'host-tok',
    guestToken: 'guest-tok',
    browserMapsKey: null,
    fakeMode,
    quotaManager: quota,
    rateLimiter,
    botRunner,
  });
  coordRef = coord;
  const srv = startAppHttpServer({
    port: 0,
    staticDir: path.join(dir, 'none'),
    shell,
    thumbStore: thumbs,
    wsCoordinator: coord,
    rateLimiter,
  });
  return { shell, srv, quota, coord, profiles };
}

test('rate limiter public_url ignores per-IP cap at 11 and bans only >30 globally', () => {
  const rlPub = createAuthRateLimiter('public_url');
  for (let i = 0; i < 15; i += 1) rlPub.recordAuthFailure('127.0.0.1', 1000 + i);
  expect(rlPub.isBlocked('127.0.0.1', 2000)).toBe(false);
  for (let i = 0; i < 16; i += 1) rlPub.recordAuthFailure('127.0.0.1', 2100 + i);
  expect(rlPub.isBlocked('127.0.0.1', 3000)).toBe(true);
});

test('blocked WS closes silently on bad token and a blocked IP cannot reconnect', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-rl-'));
  const { shell, srv } = createSecServer(dir, 'tunnel', true);
  try {
    const url = srv.baseUrl.replace('http://', 'ws://') + '/ws';
    for (let i = 0; i < 10; i += 1) {
      const c = await connectWs(url);
      c.ws.send(JSON.stringify({ type: 'hello', token: 'wrong' }));
      expect((await c.nextMsg())?.type).toBe('hello_error');
    }
    const bannedBad = await connectWs(url);
    bannedBad.ws.send(JSON.stringify({ type: 'hello', token: 'wrong' }));
    expect(await bannedBad.nextMsg(400)).toBeNull();
    expect(await bannedBad.waitClose()).toBe(1008);

    // Even with a valid token the blocked IP is refused at the WS upgrade.
    const res = await fetch(srv.baseUrl + '/ws', {
      headers: {
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    expect(res.status).toBe(429);
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

// I3 protects: claimed identity/role cannot be overwritten by public IDs or display values;
// fails_when: stranger rebinds a profile, learns its code or gains host authority;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('identical names and colors create independent guest and host seats', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-nick-'));
  const { shell, srv } = createSecServer(dir, 'local', true);
  try {
    const url = `ws://127.0.0.1:${srv.port}/ws`;
    const registrations = [];
    for (const token of ['host-tok', 'guest-tok', 'host-tok']) {
      const client = await connectWs(url);
      client.ws.send(JSON.stringify({ type: 'hello', token }));
      await messageOfType(client, 'hello_ok');
      client.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: 'Same', color: 'p-1' }));
      const joined = await messageOfType(client, 'join_ok');
      registrations.push(joined);
      expect(joined.profile.role).toBe(token === 'host-tok' ? 'host' : 'guest');
      client.ws.close();
      await client.waitClose();
    }
    expect(new Set(registrations.map((r) => r.playerId)).size).toBe(3);
    expect(new Set(registrations.map((r) => r.profile.profileId)).size).toBe(3);
    expect(shell.getState().playerOrder).toHaveLength(3);
    const owner = registrations[0];
    if (!owner) throw new Error('owner missing');
    const thief = await connectWs(url);
    thief.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
    await messageOfType(thief, 'hello_ok');
    thief.ws.send(
      JSON.stringify({
        type: 'join',
        seq: 1,
        nick: 'Same',
        color: 'p-1',
        profileId: owner.profile.profileId,
      }),
    );
    expect((await messageOfType(thief, 'join_error')).code).toBe('profile_token_required');
    expect(shell.getState().players[owner.playerId]?.isHost).toBe(true);
    thief.ws.close();
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt quota sentinel persists across restarts and pano/map loads are validated & capped', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-quota-'));
  const qFile = path.join(dir, 'quota.json');
  writeFileSync(qFile, '{bad');
  const q1 = createQuotaManager(qFile);
  expect(q1.needsResetConfirm()).toBe(true);
  expect(existsSync(`${qFile}.reset-pending`)).toBe(true);
  expect(q1.canStartMatch({ rounds: 2, humanCount: 1, botMoveLimits: [] }).allowed).toBe(false);
  q1.recordPanoLoad(1);
  expect((JSON.parse(readFileSync(qFile, 'utf8')) as { panoLoads: number }).panoLoads).toBe(1);
  const q2 = createQuotaManager(qFile);
  expect(q2.needsResetConfirm()).toBe(true);
  q2.confirmReset();
  expect(existsSync(`${qFile}.reset-pending`)).toBe(false);
  expect(q2.canStartMatch({ rounds: 2, humanCount: 1, botMoveLimits: [] }).allowed).toBe(true);

  const srvDir = path.join(dir, 'srv');
  const { shell, srv, quota } = createSecServer(srvDir, 'local', false);
  try {
    const url = srv.baseUrl.replace('http://', 'ws://') + '/ws';
    const host = await connectWs(url);
    host.ws.send(JSON.stringify({ type: 'hello', token: 'host-tok' }));
    await host.nextMsg();
    await host.nextMsg();
    host.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: 'Host', color: 'p-1' }));
    await host.nextMsg();
    await host.nextMsg();

    // Reject map_loaded / pano_loaded quota in LOBBY
    host.ws.send(JSON.stringify({ type: 'map_loaded', seq: 2, kind: 'guess' }));
    await host.nextMsg();
    host.ws.send(
      JSON.stringify({ type: 'pano_loaded', seq: 3, roundNumber: 1, countedLoad: true }),
    );
    await host.nextMsg();
    expect(quota.getState().mapLoads).toBe(0);
    expect(quota.getState().panoLoads).toBe(0);

    host.ws.send(JSON.stringify({ type: 'start_match', seq: 4 }));
    await Bun.sleep(60);
    host.ws.send(
      JSON.stringify({ type: 'pano_loaded', seq: 5, roundNumber: 1, countedLoad: true }),
    );
    host.ws.send(JSON.stringify({ type: 'map_loaded', seq: 6, kind: 'guess' }));
    host.ws.send(JSON.stringify({ type: 'map_loaded', seq: 7, kind: 'guess' }));
    await Bun.sleep(60);
    expect(quota.getState().panoLoads).toBe(1);
    expect(quota.getState().mapLoads).toBe(1);
    expect(shell.getState().quotaSummary.panoUsed).toBe(1);
    host.ws.close();
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spectators are excluded from final rankings and pre-join state is masked', () => {
  const st = createInitialRoomState({
    matchId: 'sp1',
    fakeMode: true,
    settings: {
      ...createDefaultSettings(),
      rounds: 1,
      roundDurationSec: 60,
      moveEnabled: false,
      aiWaitWindowSec: 30,
    },
    quotaSummary: {
      metrics: {
        static: buildQuotaMetric(0, 8000),
        pano: buildQuotaMetric(0, 4000),
        map: buildQuotaMetric(0, 8000),
      },
      staticUsed: 0,
      staticCeiling: 8000,
      staticWorstCase: 0,
      panoUsed: 0,
      panoCeiling: 4000,
      panoWorstCase: 2,
      mapUsed: 0,
      mapCeiling: 8000,
      mapWorstCase: 2,
      needsResetConfirm: false,
      sufficient: true,
    },
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [],
  });
  let s = reduce(
    st,
    { type: 'player_join', playerId: 'h', secret: 'sh', name: 'Host', color: 'p-1', isHost: true },
    1000,
  ).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1001).state;
  s = reduce(
    s,
    {
      type: 'round_prepared',
      matchId: 'sp1',
      gen: s.gen,
      roundNumber: 1,
      target: {
        panoId: 'p1',
        lat: 10,
        lng: 20,
        countryId: 'X',
        countryNameRu: 'Х',
        map: 'standard',
        region: 'world',
        fakeSceneIndex: 0,
      },
    },
    1002,
  ).state;
  s = reduce(
    s,
    {
      type: 'player_join',
      playerId: 'sp',
      secret: 'ss',
      name: 'Watcher',
      color: 'p-2',
      isHost: false,
    },
    1003,
  ).state;
  expect(s.players.sp?.isSpectator).toBe(true);
  const rankings = computeFinalRankings(s);
  expect(rankings.map((r) => r.item.id)).toEqual(['h']);
  expect(null as ClientViewState | null).toBeNull();
});

test('extractClientIp ignores cf-connecting-ip from non-loopback socket and limits per-IP unauth WS', async () => {
  const rl = createAuthRateLimiter('tunnel');
  const req = new Request('http://127.0.0.1/ws', {
    headers: { 'cf-connecting-ip': '203.0.113.5' },
  });
  expect(rl.extractClientIp(req, '198.51.100.10')).toBe('198.51.100.10');
  expect(rl.extractClientIp(req, '127.0.0.1')).toBe('203.0.113.5');

  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-pend-'));
  const { shell, srv } = createSecServer(dir, 'local', true);
  const pendingSockets: WsHandle[] = [];
  try {
    const url = srv.baseUrl.replace('http://', 'ws://') + '/ws';
    for (let i = 0; i < 4; i += 1) {
      pendingSockets.push(await connectWs(url));
    }
    const res5 = await fetch(srv.baseUrl + '/ws');
    expect(res5.status).toBe(429);
    for (const h of pendingSockets) h.ws.close();
    await new Promise((r) => setTimeout(r, 40));

    const valid = await connectWs(url);
    valid.ws.send(JSON.stringify({ type: 'hello', token: 'host-tok' }));
    expect((await valid.nextMsg())?.type).toBe('hello_ok');
    expect((await valid.nextMsg())?.type).toBe('state');
    valid.ws.close();
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reserves 8th room seat for host and orders hello_ok before state on reconnect', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-hostseat-'));
  const { shell, srv } = createSecServer(dir, 'local', true);
  try {
    const url = srv.baseUrl.replace('http://', 'ws://') + '/ws';
    const colors: ParticipantColorId[] = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7'];
    const guests: WsHandle[] = [];
    for (let i = 0; i < 7; i += 1) {
      const g = await connectWs(url);
      g.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
      expect((await g.nextMsg())?.type).toBe('hello_ok');
      expect((await g.nextMsg())?.type).toBe('state');
      g.ws.send(
        JSON.stringify({ type: 'join', seq: i + 1, nick: `Guest${i + 1}`, color: colors[i] }),
      );
      expect((await g.nextMsg())?.type).toBe('join_ok');
      guests.push(g);
    }

    const g8 = await connectWs(url);
    g8.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
    await g8.nextMsg();
    await g8.nextMsg();
    g8.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: 'Guest8', color: 'p-8' }));
    const err8 = await g8.nextMsg();
    expect(err8?.type === 'join_error' && err8.code === 'room_full').toBe(true);
    g8.ws.close();

    const host = await connectWs(url);
    host.ws.send(JSON.stringify({ type: 'hello', token: 'host-tok' }));
    await host.nextMsg();
    await host.nextMsg();
    host.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: 'Host', color: 'p-8' }));
    const hJoin = await host.nextMsg();
    expect(hJoin?.type).toBe('join_ok');
    if (hJoin?.type === 'join_ok') {
      const hostRec = await connectWs(url);
      hostRec.ws.send(
        JSON.stringify({
          type: 'hello',
          token: 'host-tok',
          playerId: hJoin.playerId,
          playerSecret: hJoin.playerSecret,
        }),
      );
      expect((await hostRec.nextMsg())?.type).toBe('hello_ok');
      expect((await hostRec.nextMsg())?.type).toBe('state');
      hostRec.ws.close();
    }
    for (const g of guests) g.ws.close();
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForVisionMsg(
  host: WsHandle,
  attempts = 8,
): Promise<Extract<ServerMessage, { type: 'vision_check_result' }> | null> {
  for (let i = 0; i < attempts; i += 1) {
    const m = await host.nextMsg(500);
    if (m?.type === 'vision_check_result') return m;
  }
  return null;
}

test('check_bot_vision emits vision_check_result on completion and on mid-check slot edit', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-vision-'));
  const { shell, srv } = createSecServer(dir, 'local', true, {
    startRoundBots: () => undefined,
    releaseObserve: () => undefined,
    setRoundDeadline: () => undefined,
    stopBot: () => undefined,
    stopAll: () => Promise.resolve(),
    runVisionCheck: async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { passed: true, elapsedMs: 30, message: 'OK' };
    },
    getApiBaseUrl: () => 'http://127.0.0.1:1',
    close: () => Promise.resolve(),
  });
  try {
    const url = srv.baseUrl.replace('http://', 'ws://') + '/ws';
    const host = await connectWs(url);
    host.ws.send(JSON.stringify({ type: 'hello', token: 'host-tok' }));
    await host.nextMsg();
    await host.nextMsg();
    host.ws.send(JSON.stringify({ type: 'join', seq: 0, nick: 'Host', color: 'p-1' }));
    await host.nextMsg();
    host.ws.send(JSON.stringify({ type: 'add_bot', seq: 1 }));
    let botId = '';
    for (let i = 0; i < 6 && !botId; i += 1) {
      const m = await host.nextMsg(500);
      if (m?.type === 'state' && m.view.bots[0]?.id) {
        botId = m.view.bots[0].id;
      }
    }
    expect(botId.length).toBeGreaterThan(0);
    host.ws.send(JSON.stringify({ type: 'check_bot_vision', seq: 2, botId }));

    const gotVision = await waitForVisionMsg(host);
    expect(gotVision?.type).toBe('vision_check_result');
    if (gotVision?.type === 'vision_check_result') {
      expect(gotVision.passed).toBe(true);
      expect(gotVision.botId).toBe(botId);
    }

    host.ws.send(JSON.stringify({ type: 'check_bot_vision', seq: 3, botId }));
    host.ws.send(
      JSON.stringify({ type: 'update_bot', seq: 4, botId, patch: { effort: 'medium' } }),
    );
    const midEditVision = await waitForVisionMsg(host);
    expect(midEditVision?.type).toBe('vision_check_result');
    if (midEditVision?.type === 'vision_check_result') {
      expect(midEditVision.passed).toBe(false);
      expect(midEditVision.message).toContain('изменились');
    }
    host.ws.close();
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('RoomShell confirm_quota_reset keeps the gate closed when persisting fails', async () => {
  const baseSummary = {
    metrics: {
      static: buildQuotaMetric(0, 8000),
      pano: buildQuotaMetric(0, 4000),
      map: buildQuotaMetric(0, 8000),
    },
    staticUsed: 0,
    staticCeiling: 8000,
    staticWorstCase: 0,
    panoUsed: 0,
    panoCeiling: 4000,
    panoWorstCase: 2,
    mapUsed: 0,
    mapCeiling: 8000,
    mapWorstCase: 2,
    needsResetConfirm: true,
    sufficient: false,
  };
  const asyncErrors: string[] = [];
  const snapshots: boolean[] = [];
  let shellRef: ReturnType<typeof createRoomShell> | null = null;
  shellRef = createRoomShell(
    createInitialRoomState({
      matchId: 'm-qerr',
      fakeMode: false,
      settings: {
        ...createDefaultSettings(),
        rounds: 2,
        roundDurationSec: 60,
        aiWaitWindowSec: 30,
      },
      quotaSummary: baseSummary,
      quotaWarning: 'corrupt',
      tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
      availableHarnesses: [],
    }),
    {
      onStateChange: (s) => snapshots.push(s.quotaSummary.needsResetConfirm),
      onAsyncError: (ctx) => asyncErrors.push(ctx),
      saveSettings: () => {},
      confirmQuotaReset: () => Promise.reject(new Error('disk full')),
      recalculateQuotaSummary: () => ({
        ...baseSummary,
        needsResetConfirm: true,
        sufficient: false,
      }),
      prepareRound: () => Promise.reject(new Error('unused')),
      startBotProcesses: () => undefined,
      releaseBotObserve: () => undefined,
      stopBotProcess: () => undefined,
      stopAllBots: () => undefined,
      clearRoundImages: () => undefined,
      clearThumbs: () => undefined,
      appendMatchRecord: () => Promise.resolve(),
      logRoundEnd: () => undefined,
    },
  );
  shellRef.dispatch({
    type: 'player_join',
    playerId: 'h',
    secret: 's',
    name: 'Host',
    color: 'p-1',
    isHost: true,
  });
  snapshots.length = 0;
  shellRef.dispatch({ type: 'confirm_quota_reset', playerId: 'h' });
  expect(snapshots).not.toContain(false);
  await new Promise((r) => setTimeout(r, 20));
  expect(snapshots).not.toContain(false);
  expect(asyncErrors).toContain('confirm_quota_reset');
  expect(shellRef.getState().quotaSummary.needsResetConfirm).toBe(true);
  expect(shellRef.getState().quotaWarning).toBeTruthy();
  shellRef.dispose();
});

test('second hello on an authenticated socket is rejected and cannot escalate to host', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-rehello-'));
  const { shell, srv } = createSecServer(dir, 'local', true);
  try {
    const url = srv.baseUrl.replace('http://', 'ws://') + '/ws';
    const g = await connectWs(url);
    g.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
    expect((await g.nextMsg())?.type).toBe('hello_ok');
    await g.nextMsg();
    g.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: 'Guest', color: 'p-2' }));
    const joined = (await g.nextMsg()) as Extract<ServerMessage, { type: 'join_ok' }>;
    g.ws.send(JSON.stringify({ type: 'hello', token: 'host-tok' }));
    expect(await g.waitClose()).toBe(4004);
    await Bun.sleep(40);
    expect(shell.getState().players[joined.playerId]?.connected).toBe(false);
    expect(shell.getState().players[joined.playerId]?.isHost).toBe(false);
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authenticated sockets that never join are evicted oldest-first', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-unjoined-'));
  const { shell, srv } = createSecServer(dir, 'local', true);
  try {
    const url = srv.baseUrl.replace('http://', 'ws://') + '/ws';
    const idle: Awaited<ReturnType<typeof connectWs>>[] = [];
    for (let i = 0; i < MAX_UNJOINED_AUTHENTICATED; i += 1) {
      const c = await connectWs(url);
      c.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
      await c.nextMsg();
      await c.nextMsg();
      idle.push(c);
      await Bun.sleep(2);
    }
    const late = await connectWs(url);
    expect(await idle[0]?.waitClose()).toBe(4001);
    late.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
    expect((await late.nextMsg())?.type).toBe('hello_ok');
    for (const c of [...idle.slice(1), late]) c.ws.close();
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('profile ID does not reclaim a disconnected guest and profile updates broadcast', async () => {
  // protects: profile IDs are public statistics keys and updates reach room state; fails_when: ID grants seat ownership; no_claim: browser persistence.
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-sec-profile-'));
  const { shell, srv } = createSecServer(dir, 'local');
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const guest = await connectWs(url);
  const attacker = await connectWs(url);
  try {
    guest.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
    await guest.nextMsg();
    guest.ws.send(
      JSON.stringify({ type: 'join', seq: 1, nick: 'Guest', color: 'p-2', profileId: 'public-id' }),
    );
    const joined = await messageOfType(guest, 'join_ok');
    expect(joined.type).toBe('join_ok');
    guest.ws.send(
      JSON.stringify({ type: 'update_profile', seq: 2, nick: 'Renamed', color: 'p-3' }),
    );
    let ack = await guest.nextMsg();
    while (ack && !(ack.type === 'ack' && ack.seq === 2)) ack = await guest.nextMsg();
    expect(ack?.type === 'ack' && ack.result).toBe('ok');
    expect(shell.getState().players[joined.playerId]?.name).toBe('Renamed');
    expect(shell.getState().players[joined.playerId]?.profileId).toBe('public-id');
    guest.ws.close();
    await guest.waitClose();
    attacker.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
    await attacker.nextMsg();
    attacker.ws.send(
      JSON.stringify({
        type: 'join',
        seq: 1,
        nick: 'Renamed',
        color: 'p-3',
        profileId: 'public-id',
      }),
    );
    let rejected = await attacker.nextMsg();
    if (rejected?.type === 'state') rejected = await attacker.nextMsg();
    expect(rejected?.type === 'join_error' && rejected.code).toBe('profile_token_required');
  } finally {
    guest.ws.close();
    attacker.ws.close();
    shell.dispose();
    srv.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function messageOfType<T extends ServerMessage['type']>(
  client: WsHandle,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  for (;;) {
    const msg = await client.nextMsg();
    if (!msg) throw new Error(`missing ${type}`);
    if (msg.type === type) return msg as Extract<ServerMessage, { type: T }>;
  }
}

test('host invitations create distinct seats even with the same nickname', async () => {
  // protects: invitations cannot reclaim seats by name; fails_when: matching display values select an old profile; no_claim: local fake WS, not public tunnel or paid model.
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-host-profile-'));
  const { shell, srv } = createSecServer(dir, 'local');
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const clients: WsHandle[] = [];
  try {
    for (const profileId of ['first', 'second', undefined]) {
      const client = await connectWs(url);
      clients.push(client);
      client.ws.send(JSON.stringify({ type: 'hello', token: 'host-tok' }));
      await messageOfType(client, 'hello_ok');
      client.ws.send(
        JSON.stringify({ type: 'join', seq: 1, nick: 'Host', color: 'p-1', profileId }),
      );
      const joined = await messageOfType(client, 'join_ok');
      expect(shell.getState().players[joined.playerId]?.profileId).toBe(joined.profile.profileId);
      if (profileId) expect(joined.profile.profileId).toBe(profileId);
      expect(shell.getState().playerOrder).toHaveLength(clients.length);
      client.ws.close();
      await client.waitClose();
    }
  } finally {
    for (const client of clients) client.ws.close();
    shell.dispose();
    srv.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secret restore attaches legacy profile once and reports authoritative identity', async () => {
  // protects: legacy secret-authenticated seat migration and authoritative identity; fails_when: a later hello overwrites it or public ID grants a seat; no_claim: browser persistence.
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-legacy-profile-'));
  const { shell, srv } = createSecServer(dir, 'local');
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const clients: WsHandle[] = [];
  try {
    const first = await connectWs(url);
    clients.push(first);
    first.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
    await messageOfType(first, 'hello_ok');
    shell.dispatch({
      type: 'player_join',
      playerId: 'legacy-seat',
      secret: 'test-old',
      name: 'Legacy',
      color: 'p-2',
      isHost: false,
    });
    const joined = { playerId: 'legacy-seat', playerSecret: 'test-old' };
    first.ws.close();
    await first.waitClose();
    for (const [submitted, expected] of [
      ['adopted', 'adopted'],
      ['other', 'adopted'],
    ]) {
      const client = await connectWs(url);
      clients.push(client);
      client.ws.send(
        JSON.stringify({
          type: 'hello',
          token: 'guest-tok',
          playerId: joined.playerId,
          playerSecret: joined.playerSecret,
          profileId: submitted,
        }),
      );
      const hello = await messageOfType(client, 'hello_ok');
      expect(hello.restoredPlayerId).toBe(joined.playerId);
      expect(hello.restoredProfileId).toBe(expected);
      expect(shell.getState().players[joined.playerId]?.profileId).toBe(expected);
      client.ws.close();
      await client.waitClose();
    }
    const attacker = await connectWs(url);
    clients.push(attacker);
    attacker.ws.send(
      JSON.stringify({
        type: 'hello',
        token: 'guest-tok',
        playerId: joined.playerId,
        profileId: 'adopted',
      }),
    );
    expect((await messageOfType(attacker, 'hello_ok')).restoredPlayerId).toBeUndefined();
  } finally {
    for (const client of clients) client.ws.close();
    shell.dispose();
    srv.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('simultaneous guest registrations share the last available guest place', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-last-place-'));
  const { shell, srv } = createSecServer(dir, 'local', true);
  try {
    for (let i = 0; i < 6; i++) {
      shell.dispatch({
        type: 'player_join',
        playerId: `existing-${i}`,
        name: `Игрок ${i}`,
        secret: crypto.randomUUID(),
        color: 'p-1',
        isHost: false,
      });
    }
    const url = `ws://127.0.0.1:${srv.port}/ws`;
    const guests = await Promise.all([connectWs(url), connectWs(url)]);
    for (const guest of guests) {
      guest.ws.send(JSON.stringify({ type: 'hello', token: 'guest-tok' }));
      await messageOfType(guest, 'state');
    }
    for (const [index, guest] of guests.entries()) {
      guest.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: `Гость ${index}`, color: 'p-2' }));
    }
    const replies = await Promise.all(
      guests.map(async (guest) => {
        let reply = await guest.nextMsg();
        while (reply?.type === 'state') reply = await guest.nextMsg();
        return reply;
      }),
    );
    expect(replies.map((reply) => reply?.type).sort()).toEqual(['join_error', 'join_ok']);
    expect(replies.find((reply) => reply?.type === 'join_error')).toMatchObject({
      code: 'room_full',
    });
    expect(shell.getState().playerOrder).toHaveLength(7);
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a returning profile receives a retry delay while its save budget is exhausted', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-profile-save-'));
  const { shell, srv, profiles } = createSecServer(dir, 'local', true);
  try {
    const profile = await profiles.create({ nick: 'Лиса', color: 'p-1', role: 'guest' });
    const client = await connectWs(`ws://127.0.0.1:${srv.port}/ws`);
    client.ws.send(JSON.stringify({ type: 'profile_login', profileToken: profile.profileToken }));
    await messageOfType(client, 'profile_login_ok');
    for (let i = 0; i < 8; i++) expect(profiles.admitWrite(profile.profileId)).toBe(true);
    client.ws.send(
      JSON.stringify({
        type: 'update_audio_preferences',
        seq: 1,
        preferences: DEFAULT_AUDIO_PREFERENCES,
      }),
    );
    const ack = await messageOfType(client, 'ack');
    expect(ack).toMatchObject({ seq: 1, result: 'rate_limited' });
    expect(ack.retryAfterMs).toBeGreaterThan(0);
    expect(profiles.getById(profile.profileId)?.audioPreferences).toBeUndefined();
  } finally {
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
