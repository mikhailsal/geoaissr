import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { GeoError } from '../errors.ts';
import { saveSettings } from '../storage/settings.ts';
import { createDefaultSettings } from '../../shared/storage-schemas.ts';
import type { HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { BotRunner } from '../bots/runner.ts';
import type { RoomShell } from '../engine/shell.ts';
import type { TunnelManager } from '../tunnel/cloudflared.ts';
import { buildInitialSettings, runShutdownSequence } from './start-runtime.ts';
import { startGeoServer } from './start.ts';
import { parseStartArgs } from './preflight.ts';

function withTempAppEnv<T>(
  fn: (dirs: { root: string; configDir: string; dataDir: string }) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-start-test-'));
  const configDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');
  const prevCfg = process.env.GEOAISSR_CONFIG_DIR;
  const prevData = process.env.GEOAISSR_DATA_DIR;
  process.env.GEOAISSR_CONFIG_DIR = configDir;
  process.env.GEOAISSR_DATA_DIR = dataDir;
  return fn({ root, configDir, dataDir }).finally(() => {
    if (prevCfg === undefined) delete process.env.GEOAISSR_CONFIG_DIR;
    else process.env.GEOAISSR_CONFIG_DIR = prevCfg;
    if (prevData === undefined) delete process.env.GEOAISSR_DATA_DIR;
    else process.env.GEOAISSR_DATA_DIR = prevData;
    rmSync(root, { recursive: true, force: true });
  });
}

test('buildInitialSettings disables saved enabled slot when harness is unavailable in live catalog', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-init-settings-'));
  try {
    const file = path.join(root, 'settings.json');
    const saved = createDefaultSettings();
    saved.bots = [
      {
        id: 'bot-1',
        name: 'Кодекс',
        color: 'p-4',
        harness: 'codex',
        model: 'gpt-6-luna',
        effort: 'low',
        moveLimit: 4,
        imageSize: 400,
        budgetSec: 120,
        personalityPreset: 'neutral',
        personalityText: '',
        difficultyPreset: 'amateur',
        enabled: true,
      },
    ];
    saveSettings(file, saved);
    const catalog: HarnessCatalogEntry[] = [
      { id: 'claude', available: true, readsOwnerFiles: false, models: ['haiku'] },
      {
        id: 'codex',
        available: false,
        reason: 'Не вошёл',
        readsOwnerFiles: false,
        models: ['gpt-6-luna'],
      },
      {
        id: 'agy',
        available: false,
        reason: 'Скрыт',
        readsOwnerFiles: true,
        models: ['gemini-3.8-flash-low'],
      },
    ];
    const res = buildInitialSettings({
      settingsFile: file,
      cli: parseStartArgs([]),
      availableHarnesses: catalog,
      fakeMode: false,
    });
    expect(res.settings.bots[0]?.enabled).toBe(false);
    expect(res.settingsNotice).toContain('отключена');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('startGeoServer rejects concurrent second server on same dataDir and writes redacted crash logs', async () => {
  await withTempAppEnv(async () => {
    const srv = await startGeoServer(
      { ...parseStartArgs(['--fake', '--no-tunnel', '--no-open']), port: 0 },
      {
        skipClientBuild: true,
      },
    );
    let lockErr: unknown = null;
    try {
      await startGeoServer(
        { ...parseStartArgs(['--fake', '--no-tunnel', '--no-open']), port: 0 },
        {
          skipClientBuild: true,
        },
      );
    } catch (err) {
      lockErr = err;
    }
    expect(lockErr).toBeInstanceOf(GeoError);
    expect((lockErr as GeoError).code).toBe('GEO_ALREADY_RUNNING');

    const hz = await fetch(`${srv.baseUrl}/healthz`);
    expect(hz.status).toBe(200);
    expect(await hz.json()).toEqual({ ok: true });

    const crash = await srv.simulateCrash(
      new Error(`boom token=${srv.hostToken} guest=${srv.guestToken}`),
    );
    expect(crash.exitCode).toBe(70);
    expect(existsSync(crash.crashFile)).toBe(true);
    const crashContent = readFileSync(crash.crashFile, 'utf8');
    expect(crashContent).not.toContain(srv.hostToken);
    expect(crashContent).not.toContain(srv.guestToken);
  });
});

test('startGeoServer --public-url validates DNS + /healthz readiness and masks tokens', async () => {
  await withTempAppEnv(async () => {
    let buildRan = false;
    const srv = await startGeoServer(
      {
        ...parseStartArgs(['--fake', '--public-url', 'https://play.geo-test.example', '--no-open']),
        port: 0,
      },
      {
        buildClientFn: () => {
          buildRan = true;
          return Promise.resolve(12);
        },
        fetchImpl: (url) => {
          if (url.includes('dns-query')) {
            return Promise.resolve(Response.json({ Answer: [{ data: '203.0.113.10' }] }));
          }
          return Promise.resolve(Response.json({ ok: true }));
        },
      },
    );
    try {
      expect(buildRan).toBe(true);
      expect(srv.inviteUrl).toBe(`https://play.geo-test.example/#t=${srv.guestToken}`);
      expect(srv.shell.getState().tunnel.status).toBe('ready');
    } finally {
      await srv.stop();
    }
  });
});

test('shutdown stops the front door before bots and releases the lock even if a step throws', async () => {
  const order: string[] = [];
  const pipeline = {
    httpServer: {
      stop: () => {
        order.push('http');
        throw new Error('already stopped');
      },
    },
    shell: { dispose: () => order.push('shell') } as unknown as RoomShell,
    botRunner: {
      close: () => {
        order.push('bots');
        return Promise.reject(new Error('kill failed'));
      },
    } as unknown as BotRunner,
  };
  await runShutdownSequence({
    pipeline,
    tunnel: { stop: () => Promise.resolve(void order.push('tunnel')) } as unknown as TunnelManager,
    releaseLock: () => order.push('lock'),
  });
  expect(order).toEqual(['http', 'shell', 'bots', 'tunnel', 'lock']);
});

test('stop() is idempotent: a second call waits for the same shutdown and the lock is released', async () => {
  await withTempAppEnv(async ({ dataDir }) => {
    const srv = await startGeoServer(
      { ...parseStartArgs(['--fake', '--no-tunnel', '--no-open']), port: 0 },
      { skipClientBuild: true },
    );
    const first = srv.stop();
    await srv.stop();
    expect(existsSync(path.join(dataDir, 'run', 'server.lock'))).toBe(false);
    await first;
  });
});
