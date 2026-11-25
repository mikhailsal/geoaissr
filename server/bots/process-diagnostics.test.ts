import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { EngineEvent, RoundTarget } from '../engine/types.ts';
import { createServerLogger } from '../log.ts';
import type { BotToolApiServer } from './api.ts';
import {
  spawnAndMonitorBotProcess,
  type ActiveBotHandle,
  type CustomBotLaunchBuilder,
} from './process.ts';

type BotFinished = Extract<EngineEvent, { type: 'bot_finished' }>;

const BOT_TOKEN = 'BotTokenSecret0123456789';
const GOOGLE_KEY = 'AIzaSyFakeKeyForDiagnosticsTest000';
const INVITE_TOKEN = 'InviteTokenSecret9876543210';

const SLOT: BotSlotConfig = {
  id: 'b1',
  name: 'b1',
  color: 'p-3',
  enabled: true,
  harness: 'claude',
  model: 'haiku',
  effort: 'low',
  moveLimit: 2,
  imageSize: 256,
  budgetSec: 60,
  difficultyPreset: 'amateur',
  personalityPreset: 'neutral',
  personalityText: '',
};

const TARGET: RoundTarget = {
  panoId: 'pano',
  lat: 48.8566,
  lng: 2.3522,
  countryId: '250',
  countryNameRu: 'Франция',
  map: 'standard',
  region: 'world',
  fakeSceneIndex: 0,
};

async function waitForFinished(events: EngineEvent[]): Promise<BotFinished> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = events.find((event): event is BotFinished => event.type === 'bot_finished');
    if (found) return found;
    await Bun.sleep(10);
  }
  throw new Error('bot_finished was not dispatched within 5 s');
}

/** Runs one bot through the real spawn-and-monitor path and returns the verdict the room gets. */
async function runBot(launch: CustomBotLaunchBuilder, withLogger: boolean): Promise<BotFinished> {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-diag-'));
  try {
    const events: EngineEvent[] = [];
    const logger = withLogger ? createServerLogger(dir) : undefined;
    logger?.registerSecrets([GOOGLE_KEY], [INVITE_TOKEN]);
    const api: Pick<BotToolApiServer, 'baseUrl' | 'unregisterBot'> = {
      baseUrl: 'http://127.0.0.1:1',
      unregisterBot: () => undefined,
    };
    const handle: ActiveBotHandle = {
      matchId: 'm1',
      gen: 1,
      roundNumber: 1,
      slotId: SLOT.id,
      workDir: path.join(dir, 'work'),
      token: BOT_TOKEN,
      abortQueue: () => undefined,
      stopped: false,
      releaseObserve: () => undefined,
      setStartedAt: () => undefined,
    };
    spawnAndMonitorBotProcess({
      childrenFile: path.join(dir, 'children.json'),
      api: api as BotToolApiServer,
      activeHandles: new Map(),
      handle,
      slot: SLOT,
      target: TARGET,
      roundNumber: 1,
      moveEnabled: false,
      prompt: 'unused',
      didSubmitGuess: () => false,
      dispatch: (event) => events.push(event),
      logger,
      buildCustomLaunchSpec: launch,
    });
    return await waitForFinished(events);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A CLI that dies at startup and echoes its secrets to stderr, like a verbose debug dump would.
const echoSecretsAndFail: CustomBotLaunchBuilder = ({ workDir, botToken }) => ({
  cmd: [
    '/bin/sh',
    '-c',
    'echo "auth failed: token $1 key $2 invite $3" >&2; exit 3',
    'sh',
    botToken,
    GOOGLE_KEY,
    INVITE_TOKEN,
  ],
  cwd: workDir,
});

test('stderr of a failed bot reaches the room with every known secret masked', async () => {
  const finished = await runBot(echoSecretsAndFail, true);
  expect(finished.aborted).toBe(true);
  expect(finished.reason).toContain('код 3');
  const tail = finished.diagnosticsTail ?? '';
  expect(tail).toContain('auth failed');
  for (const secret of [BOT_TOKEN, GOOGLE_KEY, INVITE_TOKEN]) {
    expect(tail).not.toContain(secret);
  }
  expect(tail).toContain('BotT…');
  expect(tail).toContain('[REDACTED]');
});

test('the bot token and Google keys are masked in stderr even without a logger', async () => {
  const finished = await runBot(echoSecretsAndFail, false);
  const tail = finished.diagnosticsTail ?? '';
  expect(tail).toContain('auth failed');
  expect(tail).not.toContain(BOT_TOKEN);
  expect(tail).not.toContain(GOOGLE_KEY);
  expect(tail).toContain('BotT…');
});

test('a launch failure masks the message before clipping it to 300 characters', async () => {
  const failingLaunch: CustomBotLaunchBuilder = ({ botToken }) => {
    // 339 characters: clipping first would cut the token and leave a readable fragment of it.
    throw new Error(`${GOOGLE_KEY} ${botToken}${'z'.repeat(280)}`);
  };
  const finished = await runBot(failingLaunch, true);
  expect(finished.reason).toBe('сбой запуска');
  const tail = finished.diagnosticsTail ?? '';
  expect(tail).not.toContain(BOT_TOKEN);
  expect(tail).not.toContain(BOT_TOKEN.slice(-10));
  expect(tail).toContain('BotT…');
});
