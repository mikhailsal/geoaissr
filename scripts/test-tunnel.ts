import { randomBytes } from 'node:crypto';
import { createInitialRoomState } from '../server/engine/types.ts';
import { createRoomShell } from '../server/engine/shell.ts';
import { createThumbStore } from '../server/http/thumbs.ts';
import { startAppHttpServer } from '../server/net/http.ts';
import { createAuthRateLimiter } from '../server/net/rate-limit.ts';
import { createWsRoomCoordinator } from '../server/net/ws.ts';
import { createFakeLocationService } from '../server/location.ts';
import { createQuotaManager } from '../server/storage/quota.ts';
import { createCloudflaredManager } from '../server/tunnel/cloudflared.ts';
import { createDefaultSettings } from '../shared/storage-schemas.ts';
import type { TunnelStatusView } from '../shared/protocol.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function parseHoldSeconds(argv: readonly string[]): number {
  const idx = argv.indexOf('--hold-sec');
  const raw = idx >= 0 ? Number(argv[idx + 1]) : 5;
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

async function runPingLoop(wsUrl: string, token: string, holdSec: number): Promise<number> {
  const ws = new WebSocket(wsUrl);
  let pongs = 0;
  let authed = false;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error('WS timeout via tunnel'));
    }, 15_000);
    ws.addEventListener(
      'open',
      () => {
        ws.send(JSON.stringify({ type: 'hello', token }));
      },
      { once: true },
    );
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as { type: string };
      if (m.type === 'hello_ok' && !authed) {
        authed = true;
        clearTimeout(t);
        resolve();
      } else if (m.type === 'pong') {
        pongs += 1;
      }
    });
    ws.addEventListener(
      'error',
      () => {
        clearTimeout(t);
        reject(new Error('WS error over tunnel'));
      },
      { once: true },
    );
  });

  const endAt = Date.now() + holdSec * 1000;
  while (Date.now() < endAt) {
    ws.send(JSON.stringify({ type: 'ping', clientNow: Date.now() }));
    await Bun.sleep(Math.min(1_000, Math.max(50, endAt - Date.now())));
  }
  ws.close();
  return pongs;
}

function createTunnelSmokeServer(dir: string, hostToken: string, guestToken: string) {
  const qm = createQuotaManager(path.join(dir, 'quota.json'));
  const loc = createFakeLocationService();
  const thumbs = createThumbStore();

  const shell = createRoomShell(
    createInitialRoomState({
      matchId: 'tunnel-smoke',
      fakeMode: true,
      settings: createDefaultSettings(),
      quotaSummary: {
        staticUsed: 0,
        staticCeiling: 8000,
        staticWorstCase: 0,
        panoUsed: 0,
        panoCeiling: 4000,
        panoWorstCase: 0,
        mapUsed: 0,
        mapCeiling: 8000,
        mapWorstCase: 0,
        needsResetConfirm: false,
        sufficient: true,
      },
      tunnel: { mode: 'tunnel', status: 'checking', inviteUrl: null, changedSinceStart: false },
      availableHarnesses: [],
    }),
    {
      saveSettings: () => Promise.resolve(),
      confirmQuotaReset: () => Promise.resolve(shell.getView('host').quota),
      prepareRound: (opts) =>
        loc.prepareRoundLocation({
          region: opts.region,
          excludeCountryIds: opts.excludeCountryIds,
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
    },
  );
  const rl = createAuthRateLimiter('tunnel');
  const wsCoord = createWsRoomCoordinator({
    shell,
    hostToken,
    guestToken,
    browserMapsKey: null,
    fakeMode: true,
    quotaManager: qm,
    rateLimiter: rl,
  });
  const srv = startAppHttpServer({
    port: 0,
    staticDir: path.join(dir, 'empty'),
    shell,
    thumbStore: thumbs,
    wsCoordinator: wsCoord,
    rateLimiter: rl,
  });
  return { shell, srv };
}

async function main(): Promise<void> {
  const holdSec = parseHoldSeconds(Bun.argv.slice(2));
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-test-tunnel-'));
  const hostToken = randomBytes(16).toString('hex');
  const guestToken = randomBytes(16).toString('hex');
  const { shell, srv } = createTunnelSmokeServer(dir, hostToken, guestToken);

  let readyUrl = '';
  const mgr = createCloudflaredManager({
    localPort: srv.port,
    guestToken,
    onStatus: (tv: TunnelStatusView) => {
      if (tv.status === 'ready' && tv.inviteUrl) {
        readyUrl = tv.inviteUrl.split('#')[0] ?? '';
      }
    },
  });

  try {
    mgr.start();
    const deadline = Date.now() + 65_000;
    while (!readyUrl && Date.now() < deadline) {
      await Bun.sleep(250);
    }
    if (!readyUrl) throw new Error('Tunnel did not become ready within 65 s');
    const wssUrl = readyUrl.replace(/^https:\/\//, 'wss://').replace(/\/$/, '') + '/ws';
    const pongs = await runPingLoop(wssUrl, guestToken, holdSec);
    console.log(`test-tunnel: OK (${readyUrl}, hold=${holdSec}s, pongs=${pongs})`);
    if (pongs < 1) throw new Error('Expected at least 1 pong via tunnel');
  } finally {
    await mgr.stop();
    srv.stop();
    shell.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main();
}
