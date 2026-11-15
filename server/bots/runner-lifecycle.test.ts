import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { EngineEvent } from '../engine/types.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { createBotImageService } from '../images/bot-image-service.ts';
import { createFakeLocationService } from '../location.ts';
import { createQuotaManager } from '../storage/quota.ts';
import { createBotRunner } from './runner.ts';

function makeSlot(id: string): BotSlotConfig {
  return {
    id,
    name: id,
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
}

async function withRunner(
  runDir: (dir: string) => string,
  fn: (runner: ReturnType<typeof createBotRunner>, events: EngineEvent[]) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-runner-'));
  const events: EngineEvent[] = [];
  const runner = createBotRunner({
    runDir: runDir(dir),
    childrenFile: path.join(dir, 'children.json'),
    fakeMode: true,
    fakeStepDelayMs: 5,
    imageService: createBotImageService({
      serverKey: null,
      fakeMode: true,
      quotaManager: createQuotaManager(path.join(dir, 'quota.json')),
      thumbStore: createThumbStore(),
    }),
    locationService: createFakeLocationService(),
    dispatch: (e) => events.push(e),
  });
  try {
    await fn(runner, events);
  } finally {
    await runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function roundParams() {
  const target = await createFakeLocationService().prepareRoundLocation({
    region: 'world',
    excludeCountryIds: [],
  });
  return { matchId: 'm1', gen: 1, roundNumber: 1, target, moveEnabled: true };
}

test('a bot whose work dir cannot be created fails alone; the other bots still get a verdict', async () => {
  await withRunner(
    (dir) => {
      const blocker = path.join(dir, 'run-is-a-file');
      writeFileSync(blocker, 'x');
      return blocker;
    },
    async (runner, events) => {
      runner.startRoundBots({ ...(await roundParams()), bots: [makeSlot('b1'), makeSlot('b2')] });
      const finished = events.filter(
        (e): e is Extract<EngineEvent, { type: 'bot_finished' }> => e.type === 'bot_finished',
      );
      expect(finished.map((e) => e.botId)).toEqual(['b1', 'b2']);
      expect(finished.every((e) => e.aborted)).toBe(true);
    },
  );
});

test('a closed runner launches no bots and no vision checks', async () => {
  await withRunner(
    (dir) => path.join(dir, 'run'),
    async (runner, events) => {
      await runner.close();
      runner.startRoundBots({ ...(await roundParams()), bots: [makeSlot('b1')] });
      await Bun.sleep(50);
      expect(events).toEqual([]);
      const vision = await runner.runVisionCheck(makeSlot('b1'));
      expect(vision.passed).toBe(false);
    },
  );
});
