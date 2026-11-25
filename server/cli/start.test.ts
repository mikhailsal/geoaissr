import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, spyOn, test } from 'bun:test';
import { GeoError } from '../errors.ts';
import { saveSettings } from '../storage/settings.ts';
import { ProfileStore } from '../storage/profiles.ts';
import { formatProfileToken } from '../../shared/profile-token.ts';
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

// Value: protects=a saved Detective whose eyes CLI is missing is disabled with a reason naming the eyes, and still starts in fake mode; fails_when=only the brain's harness is checked or the reason loses the eyes prefix; why_new=the existing case covers only a missing brain harness; seam=none; no_claim=real harness detection (catalog is hand-built).
test('buildInitialSettings disables a saved Detective whose eyes harness is missing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-init-eyes-'));
  try {
    const file = path.join(root, 'settings.json');
    const saved = createDefaultSettings();
    saved.bots = [
      {
        id: 'bot-1',
        name: 'Сыщик',
        color: 'p-4',
        harness: 'claude',
        model: 'haiku',
        effort: 'low',
        moveLimit: 4,
        imageSize: 400,
        budgetSec: 120,
        playStyle: 'detective',
        eyes: { harness: 'codex', model: 'gpt-6-luna' },
        personalityPreset: 'neutral',
        personalityText: '',
        difficultyPreset: 'amateur',
        enabled: true,
      },
    ];
    saveSettings(file, saved);
    const catalog: HarnessCatalogEntry[] = [
      { id: 'claude', available: true, readsOwnerFiles: false, models: ['haiku'] },
      { id: 'codex', available: false, reason: 'Не вошёл', readsOwnerFiles: false, models: [] },
    ];
    const build = (fakeMode: boolean) =>
      buildInitialSettings({
        settingsFile: file,
        cli: parseStartArgs([]),
        availableHarnesses: catalog,
        fakeMode,
      }).settings.bots[0];
    expect(build(false)).toMatchObject({
      enabled: false,
      disabledReason: 'Глаза детектива: Не вошёл',
    });
    // Fake mode launches no CLI, so nothing is missing.
    expect(build(true)?.enabled).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildInitialSettings renames old default names and expands saved model aliases', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-init-names-'));
  try {
    const file = path.join(root, 'settings.json');
    const saved = createDefaultSettings();
    const slot = (id: string, name: string, model: string): (typeof saved.bots)[number] => ({
      id,
      name,
      color: 'p-4',
      harness: 'codex',
      model,
      effort: 'low',
      moveLimit: 4,
      imageSize: 400,
      budgetSec: 120,
      personalityPreset: 'neutral',
      personalityText: '',
      difficultyPreset: 'amateur',
      enabled: true,
    });
    saved.bots = [
      slot('bot-1', 'ИИ Кодекс', 'gpt-6-luna'),
      slot('bot-2', 'Gemini-3.8-flash', 'gemini-3.8-flash-low'),
      {
        ...slot('bot-3', 'Гена', 'haiku'),
        harness: 'claude',
        lastVisionCheck: {
          passed: true,
          elapsedMs: 9000,
          model: 'haiku',
          effort: 'low',
          imageSize: 400,
          checkedAt: '2026-11-14T08:00:00.000Z',
        },
      },
    ];
    saveSettings(file, saved);
    const res = buildInitialSettings({
      settingsFile: file,
      cli: parseStartArgs([]),
      availableHarnesses: [],
      fakeMode: true,
    });
    expect(res.settings.bots.map((b) => b.name)).toEqual([
      'GPT 6 Luna',
      'Gemini 3.8 Flash',
      'Гена',
    ]);
    // A saved alias becomes the full id (a custom name stays) and its vision check still counts.
    expect(res.settings.bots[2]?.model).toBe('claude-haiku-5-5');
    expect(res.settings.bots[2]?.lastVisionCheck?.model).toBe('claude-haiku-5-5');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// protects=configured limits reach startup, summaries, and the live start gate; fails_when=defaults override saved ceilings or settings reload without a restart; no_claim=does not exercise paid Google requests.
test('startGeoServer reads quota ceilings once at startup and reports percentages', async () => {
  await withTempAppEnv(async ({ configDir }) => {
    const settingsFile = path.join(configDir, 'settings.json');
    const settings = { ...createDefaultSettings(), quotaCeilings: { panoLoads: 1 } };
    saveSettings(settingsFile, settings);
    const logs = spyOn(console, 'log');
    const cli = { ...parseStartArgs(['--fake', '--no-tunnel', '--no-open']), port: 0 };
    let srv: Awaited<ReturnType<typeof startGeoServer>> | undefined;
    try {
      srv = await startGeoServer(cli, { skipClientBuild: true });
      expect(srv.shell.getState().quotaSummary.panoCeiling).toBe(1);
      expect(srv.shell.getState().quotaSummary.sufficient).toBe(false);
      expect(logs.mock.calls.flat().join('\n')).toContain(
        'Static 0/8000 (0%), Pano 0/1 (0%), Карты 0/8000 (0%)',
      );
      saveSettings(settingsFile, { ...settings, quotaCeilings: { panoLoads: 40 } });
      expect(srv.shell.getState().quotaSummary.panoCeiling).toBe(1);
      await srv.stop();
      srv = await startGeoServer(cli, { skipClientBuild: true });
      expect(srv.shell.getState().quotaSummary.panoCeiling).toBe(40);
      expect(srv.shell.getState().quotaSummary.sufficient).toBe(true);
    } finally {
      await srv?.stop();
      logs.mockRestore();
    }
  });
});

// protects=loaded profile codes and invitations stay private in actual startup crash diagnostics;
// fails_when=the crash console bypasses registered credentials or accepted display variants leak;
// why_new=permanent profiles add loaded secrets outside the original invitation-only crash coverage;
// seam=none; no_claim=isolated fake startup and native crash handler, not process-signal delivery.
test('startGeoServer rejects concurrent second server on same dataDir and writes redacted crash logs', async () => {
  await withTempAppEnv(async ({ dataDir }) => {
    const profile = await new ProfileStore(path.join(dataDir, 'profiles.json')).create({
      nick: 'Private fixture',
      color: 'p-1',
      role: 'host',
    });
    const variants = [
      profile.profileToken,
      formatProfileToken(profile.profileToken).toUpperCase(),
      profile.profileToken.match(/.{4}/g)?.join(' \t') ?? profile.profileToken,
    ];
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    let srv: Awaited<ReturnType<typeof startGeoServer>> | undefined;
    try {
      srv = await startGeoServer(
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
        new Error(
          `boom token=${srv.hostToken} guest=${srv.guestToken} profiles=${variants.join(' | ')}`,
        ),
      );
      expect(crash.exitCode).toBe(70);
      expect(existsSync(crash.crashFile)).toBe(true);
      const crashContent = readFileSync(crash.crashFile, 'utf8');
      const credentials = [srv.hostToken, srv.guestToken, ...variants];
      const consoleOutput = errors.mock.calls.flat().join('\n');
      expect(credentials.some((value) => consoleOutput.includes(value))).toBe(false);
      expect(credentials.some((value) => crashContent.includes(value))).toBe(false);
    } finally {
      await srv?.stop();
      errors.mockRestore();
    }
  });
});

test('startGeoServer --public-url validates DNS + /healthz readiness and masks tokens', async () => {
  await withTempAppEnv(async () => {
    let buildRan = false;
    const terminal: string[] = [];
    const output = spyOn(console, 'log').mockImplementation((line: unknown) => {
      terminal.push(String(line));
    });
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
    ).finally(() => {
      output.mockRestore();
    });
    try {
      expect(buildRan).toBe(true);
      expect(srv.inviteUrl).toBe(`https://play.geo-test.example/#t=${srv.guestToken}`);
      const expectedOwner = `https://play.geo-test.example/?entry=owner#t=${srv.hostToken}`;
      expect(terminal.some((line) => line.endsWith(expectedOwner))).toBe(true);
      const tunnel = srv.shell.getState().tunnel;
      expect(tunnel.status).toBe('ready');
      expect(tunnel.inviteUrl === srv.inviteUrl).toBe(true);
      expect(JSON.stringify(tunnel).includes(srv.hostToken)).toBe(false);
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
