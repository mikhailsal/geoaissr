import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getHarnessAdapter } from '../../server/bots/adapters/index.ts';
import { createBotRunner } from '../../server/bots/runner.ts';
import type { EngineEvent, RoundTarget } from '../../server/engine/types.ts';
import { createThumbStore } from '../../server/http/thumbs.ts';
import { createBotImageService } from '../../server/images/bot-image-service.ts';
import { createFakeLocationService } from '../../server/location.ts';
import { createQuotaManager } from '../../server/storage/quota.ts';
import type { HarnessId } from '../../shared/storage-schemas.ts';
import type { EvalArgs } from './args.ts';
import { createDatasetImageService } from './image-service.ts';
import type { EvalSampleItem } from './manifest.ts';
import {
  buildFailedRecord,
  buildRoundRecord,
  type RoundRecord,
  type TimedEvent,
} from './records.ts';

/** Extra seconds granted after the bot budget before a round is declared timed out. */
export const BUDGET_GRACE_SEC = 15;

export type RoundSettings = Pick<
  EvalArgs,
  'dry' | 'harness' | 'budgetSec' | 'moveLimit' | 'imageSize'
>;

function makeEvalBotSlot(settings: RoundSettings) {
  const adapter = getHarnessAdapter(settings.harness);
  return {
    id: 'eval-bot',
    name: 'EvalBot',
    color: 'p-4' as const,
    harness: settings.harness satisfies HarnessId,
    model: adapter.defaultModel,
    effort: 'low' as const,
    moveLimit: settings.moveLimit,
    imageSize: settings.imageSize,
    budgetSec: settings.budgetSec,
    personalityPreset: 'neutral' as const,
    personalityText: '',
    difficultyPreset: 'custom' as const,
    enabled: true,
  };
}

function makeImageService(root: string, sample: EvalSampleItem) {
  const thumbStore = createThumbStore();
  if (sample.imagePaths) {
    return createDatasetImageService(sample.imagePaths, sample.headingDeg ?? null, thumbStore);
  }
  return createBotImageService({
    serverKey: '',
    fakeMode: true,
    quotaManager: createQuotaManager(path.join(root, 'quota.json')),
    thumbStore,
  });
}

async function waitForFinish(events: readonly TimedEvent[], budgetSec: number): Promise<boolean> {
  const deadline = Date.now() + (budgetSec + BUDGET_GRACE_SEC) * 1000;
  while (Date.now() < deadline) {
    if (events.some((e) => e.event.type === 'bot_finished')) return false;
    await Bun.sleep(25);
  }
  return !events.some((e) => e.event.type === 'bot_finished');
}

/** Runs one bot on one spot and returns its round record; never throws. */
export async function runEvalRound(opts: {
  root: string;
  settings: RoundSettings;
  sample: EvalSampleItem;
  repeat: number;
}): Promise<RoundRecord> {
  const { settings, sample } = opts;
  const slot = makeEvalBotSlot(settings);
  const baseCtx = {
    spotId: sample.id,
    repeat: opts.repeat,
    harness: settings.harness,
    model: slot.model,
    budgetSec: settings.budgetSec,
    moveLimit: settings.moveLimit,
  };
  if (!settings.dry && !sample.imagePaths) {
    return buildFailedRecord(baseCtx, new Error(`Spot "${sample.id}" has no imagePaths`));
  }
  const sub = path.join(
    opts.root,
    `${sample.id}-${opts.repeat}-${Math.random().toString(16).slice(2, 8)}`,
  );
  mkdirSync(sub, { recursive: true });
  const events: TimedEvent[] = [];
  let t0 = Date.now();
  const img = makeImageService(sub, sample);
  const runner = createBotRunner({
    runDir: path.join(sub, 'run'),
    childrenFile: path.join(sub, 'children.json'),
    fakeMode: settings.dry,
    fakeStepDelayMs: 10,
    imageService: img,
    locationService: createFakeLocationService(),
    dispatch: (event: EngineEvent) => events.push({ tMs: Date.now() - t0, event }),
  });
  const matchId = `eval-${sample.id}-${opts.repeat}`;
  const target: RoundTarget = {
    panoId: matchId,
    lat: sample.lat,
    lng: sample.lng,
    countryId: 'EVAL',
    countryNameRu: sample.countryNameRu,
    region: 'world',
    fakeSceneIndex: 0,
  };
  try {
    await img.prepareStartViews(target);
    runner.startRoundBots({
      matchId,
      gen: 1,
      roundNumber: 1,
      target,
      moveEnabled: false,
      bots: [slot],
    });
    t0 = Date.now();
    runner.releaseObserve(matchId, 1, 1);
    const timedOut = await waitForFinish(events, settings.budgetSec);
    return buildRoundRecord(
      { ...baseCtx, truth: { lat: sample.lat, lng: sample.lng }, timedOut },
      events,
    );
  } catch (err) {
    return buildFailedRecord(baseCtx, err);
  } finally {
    await runner.close();
    rmSync(sub, { recursive: true, force: true });
  }
}
