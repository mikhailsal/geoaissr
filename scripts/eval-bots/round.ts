import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getHarnessAdapter } from '../../server/bots/adapters/index.ts';
import { createBotRunner } from '../../server/bots/runner.ts';
import type { EngineEvent, RoundTarget } from '../../server/engine/types.ts';
import { createThumbStore } from '../../server/http/thumbs.ts';
import {
  createBotImageService,
  type BotImageService,
} from '../../server/images/bot-image-service.ts';
import { createFakeLocationService } from '../../server/location.ts';
import { createQuotaManager } from '../../server/storage/quota.ts';
import type { HarnessId } from '../../shared/storage-schemas.ts';
import type { EvalArgs } from './args.ts';
import { createToolAuditLogger } from './audit.ts';
import { executionPaths, makeExecutionId, type ExecutionPaths } from './exec-id.ts';
import { EVAL_BOT_NAME } from './fingerprint.ts';
import { createDatasetImageService } from './image-service.ts';
import type { EvalSampleItem } from './manifest.ts';
import {
  buildFailedRecord,
  buildRoundRecord,
  type RoundRecord,
  type TimedEvent,
  type ToolAudit,
} from './records.ts';

/** Extra seconds granted after the bot budget before a round is declared timed out. */
export const BUDGET_GRACE_SEC = 15;

/** Reasoning effort of the eval bot slot; recorded in the summary. */
export const EVAL_EFFORT = 'low' as const;

export type RoundSettings = Pick<
  EvalArgs,
  'dry' | 'harness' | 'budgetSec' | 'moveLimit' | 'imageSize'
>;

function makeEvalBotSlot(settings: RoundSettings) {
  const adapter = getHarnessAdapter(settings.harness);
  return {
    id: 'eval-bot',
    name: EVAL_BOT_NAME,
    color: 'p-4' as const,
    harness: settings.harness satisfies HarnessId,
    model: adapter.defaultModel,
    effort: EVAL_EFFORT,
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

interface RoundRig {
  img: BotImageService;
  runner: ReturnType<typeof createBotRunner>;
  audit: () => ToolAudit | null;
}

function buildRig(
  paths: ExecutionPaths,
  settings: RoundSettings,
  sample: EvalSampleItem,
  dispatch: (event: EngineEvent) => void,
): RoundRig {
  const img = makeImageService(paths.dir, sample);
  const { logger, audit } = createToolAuditLogger();
  const runner = createBotRunner({
    runDir: paths.runDir,
    childrenFile: paths.childrenFile,
    fakeMode: settings.dry,
    fakeStepDelayMs: 10,
    imageService: img,
    locationService: createFakeLocationService(),
    dispatch,
    logger,
  });
  return { img, runner, audit };
}

/** Resolves `timedOut` once the bot finished (false), the budget ran out (true) or the run aborted. */
async function waitForFinish(
  events: readonly TimedEvent[],
  budgetSec: number,
  signal: AbortSignal,
): Promise<{ timedOut: boolean; aborted: boolean }> {
  const deadline = Date.now() + (budgetSec + BUDGET_GRACE_SEC) * 1000;
  while (Date.now() < deadline) {
    if (events.some((e) => e.event.type === 'bot_finished')) {
      return { timedOut: false, aborted: false };
    }
    if (signal.aborted) return { timedOut: false, aborted: true };
    await Bun.sleep(25);
  }
  return { timedOut: !events.some((e) => e.event.type === 'bot_finished'), aborted: false };
}

/**
 * Runs one bot on one spot and returns its round record; never throws.
 * Returns null when `signal` aborted the round (an interrupted round is not a measurement).
 */
export async function runEvalRound(opts: {
  root: string;
  runName: string;
  settings: RoundSettings;
  sample: EvalSampleItem;
  repeat: number;
  signal: AbortSignal;
}): Promise<RoundRecord | null> {
  const { settings, sample } = opts;
  const slot = makeEvalBotSlot(settings);
  const executionId = makeExecutionId(opts.runName, sample.id, opts.repeat);
  const baseCtx = {
    spotId: sample.id,
    executionId,
    repeat: opts.repeat,
    harness: settings.harness,
    model: slot.model,
    budgetSec: settings.budgetSec,
    moveLimit: settings.moveLimit,
  };
  if (!settings.dry && !sample.imagePaths) {
    return buildFailedRecord(baseCtx, new Error(`Spot "${sample.id}" has no imagePaths`));
  }
  // Every path and the match id carry only the opaque execution id (see exec-id.ts).
  const paths = executionPaths(opts.root, executionId);
  const events: TimedEvent[] = [];
  let t0 = Date.now();
  let rig: RoundRig | null = null;
  try {
    // Setup failures (an unreadable or corrupt frame) become an infra record, never a throw.
    mkdirSync(paths.dir, { recursive: true });
    rig = buildRig(paths, settings, sample, (event) => {
      events.push({ tMs: Date.now() - t0, event });
    });
    const target: RoundTarget = {
      panoId: paths.matchId,
      lat: sample.lat,
      lng: sample.lng,
      countryId: 'EVAL',
      countryNameRu: sample.countryNameRu,
      map: 'standard',
      region: 'world',
      fakeSceneIndex: 0,
    };
    await rig.img.prepareStartViews(target);
    rig.runner.startRoundBots({
      matchId: paths.matchId,
      gen: 1,
      roundNumber: 1,
      target,
      moveEnabled: false,
      bots: [slot],
    });
    t0 = Date.now();
    rig.runner.releaseObserve(paths.matchId, 1, 1);
    const { timedOut, aborted } = await waitForFinish(events, settings.budgetSec, opts.signal);
    if (aborted) return null;
    return buildRoundRecord(
      { ...baseCtx, truth: { lat: sample.lat, lng: sample.lng }, timedOut, audit: rig.audit() },
      events,
    );
  } catch (err) {
    return buildFailedRecord(baseCtx, err);
  } finally {
    await rig?.runner.close();
    rmSync(paths.dir, { recursive: true, force: true });
  }
}
