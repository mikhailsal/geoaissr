import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../storage/profiles.ts';
import { expect, test } from 'bun:test';
import { createRoomShell } from '../engine/shell.ts';
import { createInitialRoomState } from '../engine/types.ts';
import { GeoError } from '../errors.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { startAppHttpServer } from '../net/http.ts';
import { createAuthRateLimiter } from '../net/rate-limit.ts';
import { createWsRoomCoordinator } from '../net/ws.ts';
import { buildQuotaMetric, createQuotaManager } from '../storage/quota.ts';
import { assertPortAvailable, parseStartArgs, resolveGoogleEnvKeys } from './preflight.ts';

test('parseStartArgs parses defaults, PORT env, flags, and rejects conflicts', () => {
  expect(parseStartArgs([], {}).port).toBe(5174);
  expect(parseStartArgs([], { PORT: '6123' }).port).toBe(6123);

  const custom = parseStartArgs([
    '--fake',
    '--port',
    '7777',
    '--rounds',
    '3',
    '--duration',
    '90',
    '--region',
    'europe',
    '--no-move',
    '--no-open',
    '--public-url',
    'https://geo.example.com/',
  ]);
  expect(custom).toEqual({
    fake: true,
    noTunnel: false,
    noOpen: true,
    port: 7777,
    publicUrl: 'https://geo.example.com',
    roundsOverride: 3,
    regionOverride: 'europe',
    durationOverride: 90,
    noMoveOverride: true,
  });

  expect(() => parseStartArgs(['--public-url', 'https://a.example', '--no-tunnel'])).toThrow();
  expect(() => parseStartArgs(['--bogus'])).toThrow();
});

test('resolveGoogleEnvKeys allows empty keys in fake mode and rejects missing keys in live mode', () => {
  expect(resolveGoogleEnvKeys(true, {})).toEqual({ browserKey: null, serverKey: null });
  expect(() => resolveGoogleEnvKeys(false, {})).toThrow();
  expect(
    resolveGoogleEnvKeys(false, { GOOGLE_MAPS_BROWSER_KEY: 'b', GOOGLE_MAPS_SERVER_KEY: 's' }),
  ).toEqual({
    browserKey: 'b',
    serverKey: 's',
  });
});

test('assertPortAvailable throws GEO_PORT_BUSY when TCP port is already bound', async () => {
  const srv = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') });
  let caught: unknown = null;
  try {
    await assertPortAvailable(srv.port ?? 0);
  } catch (err) {
    caught = err;
  } finally {
    void srv.stop(true);
  }
  expect(caught).toBeInstanceOf(GeoError);
  expect((caught as GeoError).code).toBe('GEO_PORT_BUSY');
});

function makePortTestShell() {
  const quotaSummary = {
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
    panoWorstCase: 6,
    mapUsed: 0,
    mapCeiling: 8000,
    mapWorstCase: 6,
    needsResetConfirm: false,
    sufficient: true,
  };
  return createRoomShell(
    createInitialRoomState({
      matchId: 'm-port',
      fakeMode: true,
      settings: {
        version: 1,
        region: 'world',
        rounds: 3,
        roundDurationSec: 60,
        moveEnabled: true,
        aiWaitWindowSec: 30,
        showMatchStandings: true,
        pushEnabled: false,
        allowBotPush: true,
        bots: [],
      },
      quotaSummary,
      tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
      availableHarnesses: [],
    }),
    {
      saveSettings: () => {},
      confirmQuotaReset: () => Promise.resolve(quotaSummary),
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
}

test('startAppHttpServer maps bind EADDRINUSE to GEO_PORT_BUSY without TOCTOU crash', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-port-profile-'));
  const blocker = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') });
  const shell = makePortTestShell();
  const rl = createAuthRateLimiter('local');
  const coord = createWsRoomCoordinator({
    shell,
    profiles: new ProfileStore(path.join(dir, 'profiles.json')),
    hostToken: 'h',
    guestToken: 'g',
    browserMapsKey: null,
    fakeMode: true,
    quotaManager: createQuotaManager('/tmp/geo-nonexistent-quota-port-test.json'),
    rateLimiter: rl,
  });
  let caught: unknown = null;
  try {
    startAppHttpServer({
      port: blocker.port ?? 0,
      staticDir: '/tmp/geo-no-static',
      shell,
      thumbStore: createThumbStore(),
      wsCoordinator: coord,
      rateLimiter: rl,
    });
  } catch (err) {
    caught = err;
  } finally {
    shell.dispose();
    void blocker.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
  expect(caught).toBeInstanceOf(GeoError);
  expect((caught as GeoError).code).toBe('GEO_PORT_BUSY');
});
