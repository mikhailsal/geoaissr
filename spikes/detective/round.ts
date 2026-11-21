import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { RoundTarget } from '../../server/engine/types.ts';
import { createThumbStore } from '../../server/http/thumbs.ts';
import {
  createBotImageService,
  type BotImageService,
} from '../../server/images/bot-image-service.ts';
import { createQuotaManager } from '../../server/storage/quota.ts';
import { getRegionDiagonalKm } from '../../shared/regions.ts';
import type { BotImageSize, EffortLevel } from '../../shared/bot-tools.ts';
import { executionPaths, makeExecutionId } from '../../scripts/eval-bots/exec-id.ts';
import { createDatasetImageService } from '../../scripts/eval-bots/image-service.ts';
import type { EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import type { CatalogFeature } from './catalog.ts';
import { runFakeBrain, runFakeEyes } from './fake.ts';
import type { Protocol } from './protocol.ts';
import { launchRole, type RoleProcess } from './procs.ts';
import { buildBrainPrompt, buildEyesPrompt } from './prompts.ts';
import {
  buildDetectiveRecord,
  type Arm,
  type DetectiveRoundRecord,
  type RoleExit,
} from './records.ts';
import { startDetectiveToolServer } from './server.ts';
import { createDetectiveSession, type DetectiveSession } from './session.ts';

/**
 * One Detective round on one spot:
 *   tool server (two role tokens) ─► brain CLI (text only) + eyes CLI (frames)  [arm detective]
 *                                 └► brain CLI only, answers from the labels      [arm labels]
 * The round ends at final_guess, when the brain exits, or when the budget runs out.
 */

export interface DetectiveSettings {
  arm: Arm;
  budgetSec: number;
  moveLimit: number;
  imageSize: BotImageSize;
  brainModel: string;
  eyesModel: string;
  /** The eyes' effort; the brain's is `brainEffort` (spike 3, Part B rule). */
  effort: EffortLevel;
  brainEffort: EffortLevel;
  protocol: Protocol;
  requireZoom: boolean;
  dry: boolean;
}

/** Seconds after the budget before the processes are stopped. */
const STOP_GRACE_MS = 2000;

function makeImageService(dir: string, sample: EvalSampleItem): BotImageService {
  const thumbStore = createThumbStore();
  if (sample.imagePaths) {
    return createDatasetImageService(sample.imagePaths, sample.headingDeg ?? null, thumbStore);
  }
  return createBotImageService({
    serverKey: '',
    fakeMode: true,
    quotaManager: createQuotaManager(path.join(dir, 'quota.json')),
    thumbStore,
  });
}

function evalTarget(matchId: string, sample: EvalSampleItem): RoundTarget {
  return {
    panoId: matchId,
    lat: sample.lat,
    lng: sample.lng,
    countryId: 'EVAL',
    countryNameRu: sample.countryNameRu,
    region: 'world',
    fakeSceneIndex: 0,
  };
}

/** Resolves when the round is over: final guess, brain exit, budget end or abort. */
function waitForRoundEnd(
  session: DetectiveSession,
  brainDone: Promise<unknown>,
  budgetSec: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, budgetSec * 1000 + STOP_GRACE_MS);
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };
    session.onFinal(finish);
    void brainDone.then(finish);
    signal.addEventListener('abort', finish, { once: true });
  });
}

interface Launched {
  brain: RoleProcess | null;
  eyes: RoleProcess | null;
  fakeDone: Promise<void> | null;
}

function launchRoles(
  settings: DetectiveSettings,
  session: DetectiveSession,
  server: ReturnType<typeof startDetectiveToolServer>,
  dirs: { brain: string; eyes: string; childrenFile: string },
  catalog: readonly CatalogFeature[],
): Launched {
  if (settings.dry) {
    const eyes = settings.arm === 'detective' ? runFakeEyes(session) : Promise.resolve();
    return {
      brain: null,
      eyes: null,
      fakeDone: Promise.all([eyes, runFakeBrain(session)]).then(() => undefined),
    };
  }
  const common = { childrenFile: dirs.childrenFile, apiUrl: server.baseUrl };
  const brainPrompt = buildBrainPrompt({
    regionLabelRu: 'весь мир',
    regionDiagonalKm: getRegionDiagonalKm('world'),
    budgetSec: settings.budgetSec,
    catalog,
    protocol: settings.protocol,
  });
  const brain = launchRole({
    ...common,
    model: settings.brainModel,
    effort: settings.brainEffort,
    role: 'brain',
    workDir: dirs.brain,
    prompt: brainPrompt,
    token: server.tokens.brain,
  });
  const eyes =
    settings.arm === 'detective'
      ? launchRole({
          ...common,
          model: settings.eyesModel,
          effort: settings.effort,
          role: 'eyes',
          workDir: dirs.eyes,
          prompt: buildEyesPrompt({
            moveLimit: settings.moveLimit,
            protocol: settings.protocol,
            requireZoom: settings.requireZoom,
          }),
          token: server.tokens.eyes,
        })
      : null;
  // The eyes leaving early must not leave the brain waiting on a request nobody will answer.
  void eyes?.done.then(() => {
    session.eyesExited();
  });
  return { brain, eyes, fakeDone: null };
}

/**
 * After the round ends each CLI is told so by its next tool reply and finishes its turn; only
 * then does `claude -p` print the result JSON that carries the token usage. A CLI still running
 * after the grace period is stopped and reports no usage.
 */
const EXIT_GRACE_MS = 25_000;

async function stopRoles(
  launched: Launched,
): Promise<{ brain: RoleExit | null; eyes: RoleExit | null }> {
  const procs = [launched.brain, launched.eyes].filter((p): p is RoleProcess => p !== null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(procs.map((p) => p.done)),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, EXIT_GRACE_MS);
    }),
  ]);
  clearTimeout(timer);
  await Promise.allSettled(procs.map((p) => p.proc.stop(500)));
  await launched.fakeDone;
  return {
    brain: launched.brain ? await launched.brain.done : null,
    eyes: launched.eyes ? await launched.eyes.done : null,
  };
}

export async function runDetectiveRound(opts: {
  root: string;
  runName: string;
  settings: DetectiveSettings;
  sample: EvalSampleItem;
  repeat: number;
  catalog: CatalogFeature[];
  signal: AbortSignal;
}): Promise<DetectiveRoundRecord | null> {
  const { settings, sample } = opts;
  const executionId = makeExecutionId(opts.runName, sample.id, opts.repeat);
  const paths = executionPaths(opts.root, executionId);
  // Sibling work dirs: the brain's directory never contains a frame.
  const dirs = {
    brain: path.join(paths.dir, 'brain'),
    eyes: path.join(paths.dir, 'eyes'),
    childrenFile: paths.childrenFile,
  };
  mkdirSync(paths.dir, { recursive: true });
  const imageService = makeImageService(paths.dir, sample);
  const target = evalTarget(paths.matchId, sample);
  await imageService.prepareStartViews(target);
  const session = createDetectiveSession({
    sample,
    catalog: opts.catalog,
    imageService,
    target,
    imageSize: settings.imageSize,
    moveLimit: settings.moveLimit,
    budgetSec: settings.budgetSec,
    answerSource: settings.arm === 'detective' ? 'eyes' : 'labels',
    protocol: settings.protocol,
    requireZoom: settings.requireZoom,
  });
  const server = startDetectiveToolServer(session, opts.catalog);
  try {
    session.start();
    const launched = launchRoles(settings, session, server, dirs, opts.catalog);
    const brainDone = launched.brain?.done ?? launched.fakeDone ?? Promise.resolve();
    await waitForRoundEnd(session, brainDone, settings.budgetSec, opts.signal);
    session.end();
    const exits = await stopRoles(launched);
    if (opts.signal.aborted) return null;
    return buildDetectiveRecord({
      sample,
      executionId,
      repeat: opts.repeat,
      arm: settings.arm,
      model: settings.brainModel,
      eyesModel: settings.arm === 'detective' ? settings.eyesModel : '',
      budgetSec: settings.budgetSec,
      moveLimit: settings.moveLimit,
      state: session.state,
      ...exits,
    });
  } finally {
    server.close();
    imageService.clearRound();
    rmSync(paths.dir, { recursive: true, force: true });
  }
}
