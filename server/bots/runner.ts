import type { BotCostEstimate, BotTokenUsage } from '../../shared/bot-results.ts';
import { mkdirSync } from 'node:fs';
import { getRegionDiagonalKm } from '../../shared/regions.ts';
import type { BotSlotConfig, RegionId } from '../../shared/storage-schemas.ts';
import type { EngineEvent, RoundTarget } from '../engine/types.ts';
import type { BotImageService, RenderedBotImage } from '../images/bot-image-service.ts';
import { normalizeHeadingDeg } from '../images/label.ts';
import type { LocationService } from '../location.ts';
import type { ServerLogger } from '../log.ts';
import { joinUnder } from '../paths.ts';
import { getHarnessAdapter } from './adapters/index.ts';
import { createBotToolApiServer, type BotToolApiServer } from './api.ts';
import { startMonitoredFakeBot } from './fake-bot.ts';
import { createMoveTracker, type MoveTracker } from './move.ts';
import {
  cleanupBotHandle,
  createGatePair,
  dispatchBotLaunchFailure,
  spawnAndMonitorBotProcess,
  type ActiveBotHandle,
  type CustomBotLaunchBuilder,
} from './process.ts';
import { buildBotRoundPrompt } from './prompt.ts';
import {
  createBotToolQueue,
  type BotSessionHandlers,
  type BotToolQueue,
  type ToolResponsePayload,
} from './queue.ts';
import { dispatchObserveThumbs, makeThumb } from './thumbs.ts';
import { runVisionCheck } from './vision-check.ts';

const REGION_LABELS_RU: Record<RegionId, string> = {
  world: 'Весь мир',
  europe: 'Европа',
  asia: 'Азия',
  north_america: 'Северная Америка',
  south_america: 'Южная Америка',
  africa: 'Африка',
  oceania: 'Океания',
};

export interface BotRunner {
  startRoundBots: (opts: {
    matchId: string;
    gen: number;
    roundNumber: number;
    target: RoundTarget;
    bots: BotSlotConfig[];
    moveEnabled: boolean;
  }) => void;
  releaseObserve: (matchId: string, gen: number, roundNumber: number) => void;
  stopBot: (matchId: string, gen: number, botId: string, reason: string) => void;
  stopAll: (reason: string) => Promise<void>;
  runVisionCheck: (
    bot: BotSlotConfig,
  ) => Promise<{ passed: boolean; elapsedMs: number; message: string }>;
  getApiBaseUrl: () => string;
  close: () => Promise<void>;
}

interface RunnerCtx {
  runDir: string;
  childrenFile: string;
  fakeMode: boolean;
  fakeStepDelayMs?: number;
  imageService: BotImageService;
  locationService: LocationService;
  dispatch: (event: EngineEvent) => void;
  logger?: ServerLogger;
  buildCustomLaunchSpec?: CustomBotLaunchBuilder;
  estimateCost?: (model: string, usage: BotTokenUsage) => Promise<BotCostEstimate>;
  api: BotToolApiServer;
  activeHandles: Map<string, ActiveBotHandle>;
  activeVisionChecks: Map<AbortController, Promise<unknown>>;
}

interface RoundBotParams {
  matchId: string;
  gen: number;
  roundNumber: number;
  target: RoundTarget;
  slot: BotSlotConfig;
  moveEnabled: boolean;
}

function toImageBlocks(
  imgs: RenderedBotImage[],
): Array<{ name: string; base64: string; mimeType: string }> {
  return imgs.map((img, i) => ({
    name: `frame-${Date.now()}-${i + 1}.jpg`,
    base64: img.jpeg.toString('base64'),
    mimeType: 'image/jpeg',
  }));
}

async function runLookTool(
  ctx: RunnerCtx,
  params: RoundBotParams,
  tracker: MoveTracker,
  turnNum: number,
  args: { heading: number; pitch: number; fov: number; hypothesis?: string },
): Promise<ToolResponsePayload> {
  const pos = tracker.getPosition();
  try {
    const view = await ctx.imageService.getLookView({
      panoId: pos.panoId,
      lat: pos.lat,
      lng: pos.lng,
      heading: args.heading,
      pitch: args.pitch,
      fov: args.fov,
      size: params.slot.imageSize,
      fakeSceneIndex: pos.fakeSceneIndex,
    });
    ctx.dispatch({
      type: 'bot_thumb_added',
      matchId: params.matchId,
      gen: params.gen,
      roundNumber: params.roundNumber,
      botId: params.slot.id,
      thumb: makeThumb(turnNum, 'look', view, {
        params: {
          heading: normalizeHeadingDeg(args.heading),
          pitch: Math.round(args.pitch),
          fov: Math.round(args.fov),
        },
        ...(args.hypothesis ? { hypothesis: args.hypothesis } : {}),
      }),
    });
    return { text: view.label, images: toImageBlocks([view]) };
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}

async function runMoveTool(
  ctx: RunnerCtx,
  params: RoundBotParams,
  tracker: MoveTracker,
  turnNum: number,
  args: { heading: number; hypothesis?: string },
): Promise<ToolResponsePayload> {
  const prevPos = tracker.getPosition();
  try {
    const res = await tracker.stepToward(args.heading);
    if (!res.ok) return { text: res.message ?? 'Тупик', isError: true };
    try {
      const view = await ctx.imageService.getMoveView({
        panoId: res.position.panoId,
        lat: res.position.lat,
        lng: res.position.lng,
        heading: args.heading,
        step: res.position.steps,
        size: params.slot.imageSize,
        fakeSceneIndex: res.position.fakeSceneIndex,
      });
      ctx.dispatch({
        type: 'bot_thumb_added',
        matchId: params.matchId,
        gen: params.gen,
        roundNumber: params.roundNumber,
        botId: params.slot.id,
        thumb: makeThumb(turnNum, 'move', view, {
          params: { heading: normalizeHeadingDeg(args.heading), step: res.position.steps },
          ...(args.hypothesis ? { hypothesis: args.hypothesis } : {}),
        }),
      });
      return { text: `Перемещение выполнено (${view.label}).`, images: toImageBlocks([view]) };
    } catch (err) {
      tracker.restorePosition(prevPos);
      throw err;
    }
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}

function createLoggedToolExecutor<TArgs, TRes extends { isError?: boolean }>(
  ctx: RunnerCtx,
  slotId: string,
  roundNumber: number,
  tool: string,
  fn: (args: TArgs) => Promise<TRes>,
): (args: TArgs) => Promise<TRes> {
  return async (args) => {
    const t0 = Date.now();
    const res = await fn(args);
    ctx.logger?.log('bot_tool_call', {
      slotId,
      roundNumber,
      tool,
      args, // heading/pitch/fov of a look, direction of a move: where the bot spent its turns
      durationMs: Date.now() - t0,
      ok: !res.isError,
    });
    return res;
  };
}

function buildRoundHandlers(
  ctx: RunnerCtx,
  params: RoundBotParams,
  deps: {
    tracker: MoveTracker;
    waitObserveRelease: (signal: AbortSignal) => Promise<void>;
    getTurnsUsed: () => number;
    getStartedAt: () => number;
    onSubmittedGuess: () => void;
  },
): BotSessionHandlers {
  const { matchId, gen, roundNumber, target, slot } = params;
  return {
    waitObserveRelease: deps.waitObserveRelease,
    async executeObserve(): Promise<ToolResponsePayload> {
      const t0 = Date.now();
      try {
        const views = await ctx.imageService.getObserveViews({ target, size: slot.imageSize });
        dispatchObserveThumbs(
          ctx.dispatch,
          { matchId, gen, roundNumber, botId: slot.id },
          deps.getTurnsUsed(),
          views,
        );
        ctx.logger?.log('bot_tool_call', {
          slotId: slot.id,
          roundNumber,
          tool: 'observe',
          durationMs: Date.now() - t0,
          ok: true,
        });
        return {
          text: `Стартовые 4 кадра (С, В, Ю, З). Регион: ${REGION_LABELS_RU[target.region]}, макс. масштаб D ≈ ${Math.round(getRegionDiagonalKm(target.region))} км.`,
          images: toImageBlocks(views),
        };
      } catch (err) {
        return { text: err instanceof Error ? err.message : String(err), isError: true };
      }
    },
    executeLook: createLoggedToolExecutor(ctx, slot.id, roundNumber, 'look', (args) =>
      runLookTool(ctx, params, deps.tracker, deps.getTurnsUsed() + 1, args),
    ),
    executeMove: createLoggedToolExecutor(ctx, slot.id, roundNumber, 'move', (args) =>
      runMoveTool(ctx, params, deps.tracker, deps.getTurnsUsed() + 1, args),
    ),
    onGuess(guess, finalized) {
      deps.onSubmittedGuess();
      ctx.logger?.log('bot_tool_call', {
        slotId: slot.id,
        roundNumber,
        tool: finalized ? 'final_guess' : 'draft_guess',
        args: { lat: guess.lat, lng: guess.lng },
        ok: true,
      });
      ctx.dispatch({
        type: 'bot_guess_recorded',
        matchId,
        gen,
        roundNumber,
        botId: slot.id,
        guess,
        finalized,
      });
    },
    onTurnsChanged: (turnsUsed) => {
      ctx.dispatch({
        type: 'bot_turns_updated',
        matchId,
        gen,
        roundNumber,
        botId: slot.id,
        turnsUsed,
      });
    },
    getRemainingTimeSec: () =>
      Math.max(0, slot.budgetSec - (Date.now() - deps.getStartedAt()) / 1000),
  };
}
function startBotExecution(
  ctx: RunnerCtx,
  params: RoundBotParams,
  handle: ActiveBotHandle,
  waitOnce: () => Promise<void>,
  didSubmitGuess: () => boolean,
): void {
  const { matchId, gen, roundNumber, target, slot, moveEnabled } = params;
  if (ctx.fakeMode && !ctx.buildCustomLaunchSpec) {
    startMonitoredFakeBot({
      matchId,
      gen,
      roundNumber,
      slot,
      target,
      imageService: ctx.imageService,
      observePromise: waitOnce(),
      dispatch: ctx.dispatch,
      stepDelayMs: ctx.fakeStepDelayMs ?? 250,
      api: ctx.api,
      activeHandles: ctx.activeHandles,
      handle,
      logger: ctx.logger,
    });
    return;
  }
  const adapter = getHarnessAdapter(slot.harness);
  const prompt = buildBotRoundPrompt({
    botName: slot.name,
    regionLabelRu: REGION_LABELS_RU[target.region],
    moveEnabled,
    moveLimit: slot.moveLimit,
    budgetSec: slot.budgetSec,
    personalityPreset: slot.personalityPreset,
    personalityText: slot.personalityText,
    deliveryMode: adapter.deliveryMode,
  });
  spawnAndMonitorBotProcess({
    childrenFile: ctx.childrenFile,
    api: ctx.api,
    activeHandles: ctx.activeHandles,
    handle,
    slot,
    target,
    roundNumber,
    moveEnabled,
    prompt,
    didSubmitGuess,
    dispatch: ctx.dispatch,
    logger: ctx.logger,
    buildCustomLaunchSpec: ctx.buildCustomLaunchSpec,
    estimateCost: ctx.estimateCost,
  });
}

function launchBotProcess(ctx: RunnerCtx, params: RoundBotParams): void {
  const { matchId, gen, roundNumber, target, slot, moveEnabled } = params;
  const workDir = joinUnder(ctx.runDir, matchId, `r${roundNumber}-g${gen}`, slot.id);
  mkdirSync(workDir, { recursive: true });
  const tracker = createMoveTracker({
    initial: target,
    moveEnabled,
    fakeMode: ctx.fakeMode,
    locationService: ctx.locationService,
  });

  const roundRef = { startedAt: Date.now(), submittedGuess: false };
  const gate = createGatePair();
  const queueState: { instance: BotToolQueue | null } = { instance: null };
  const queue = createBotToolQueue({
    moveLimit: slot.moveLimit,
    moveEnabled,
    handlers: buildRoundHandlers(ctx, params, {
      tracker,
      waitObserveRelease: gate.waitObserveRelease,
      getTurnsUsed: () => queueState.instance?.getTurnsUsed() ?? 0,
      getStartedAt: () => roundRef.startedAt,
      onSubmittedGuess: () => {
        roundRef.submittedGuess = true;
      },
    }),
  });
  queueState.instance = queue;

  const token = ctx.api.registerBot(queue);
  const handle: ActiveBotHandle = {
    matchId,
    gen,
    roundNumber,
    slotId: slot.id,
    workDir,
    token,
    abortQueue: (reason) => {
      queue.abort(reason);
    },
    stopped: false,
    releaseObserve: gate.releaseObserve,
    setStartedAt: (ms) => {
      roundRef.startedAt = ms;
    },
  };
  const prev = ctx.activeHandles.get(slot.id);
  if (prev) {
    void stopBotHandle(ctx, prev, 'superseded');
  }
  ctx.activeHandles.set(slot.id, handle);
  try {
    startBotExecution(ctx, params, handle, gate.waitOnce, () => roundRef.submittedGuess);
  } catch (err) {
    cleanupBotHandle(ctx.api, ctx.activeHandles, handle);
    dispatchLaunchFailure(ctx, params, err, handle.token);
  }
}
function dispatchLaunchFailure(
  ctx: RunnerCtx,
  params: RoundBotParams,
  err: unknown,
  token?: string,
): void {
  dispatchBotLaunchFailure({
    dispatch: ctx.dispatch,
    matchId: params.matchId,
    gen: params.gen,
    roundNumber: params.roundNumber,
    botId: params.slot.id,
    token,
    err,
    logger: ctx.logger,
  });
}

async function stopBotHandle(ctx: RunnerCtx, h: ActiveBotHandle, reason: string): Promise<void> {
  h.stopped = true;
  h.abortQueue(reason);
  // Swallow stop failures: callers fire-and-forget this, and cleanup must still run.
  await h.proc?.stop(500).catch(() => undefined);
  cleanupBotHandle(ctx.api, ctx.activeHandles, h);
}

export function createBotRunner(opts: {
  runDir: string;
  childrenFile: string;
  fakeMode: boolean;
  fakeStepDelayMs?: number;
  imageService: BotImageService;
  locationService: LocationService;
  dispatch: (event: EngineEvent) => void;
  logger?: ServerLogger;
  buildCustomLaunchSpec?: CustomBotLaunchBuilder;
  estimateCost?: (model: string, usage: BotTokenUsage) => Promise<BotCostEstimate>;
}): BotRunner {
  const ctx: RunnerCtx = {
    ...opts,
    api: createBotToolApiServer(),
    activeHandles: new Map(),
    activeVisionChecks: new Map(),
  };

  let closed = false;
  return {
    startRoundBots({ matchId, gen, roundNumber, target, bots, moveEnabled }) {
      if (closed) return;
      for (const slot of bots) {
        const params = { matchId, gen, roundNumber, target, slot, moveEnabled };
        try {
          launchBotProcess(ctx, params);
        } catch (err) {
          // One bot failing to launch (e.g. disk full) must not block the others.
          dispatchLaunchFailure(ctx, params, err);
        }
      }
    },
    releaseObserve(matchId, gen, roundNumber) {
      const now = Date.now();
      for (const h of ctx.activeHandles.values()) {
        if (h.matchId === matchId && h.gen === gen && h.roundNumber === roundNumber) {
          h.setStartedAt(now);
          h.releaseObserve();
        }
      }
    },
    stopBot(matchId, gen, botId, reason) {
      const h = ctx.activeHandles.get(botId);
      if (!h || h.matchId !== matchId || h.gen !== gen) return;
      void stopBotHandle(ctx, h, reason);
    },
    async stopAll(reason) {
      const stops = [...ctx.activeHandles.values()].map((h) => stopBotHandle(ctx, h, reason));
      await Promise.allSettled(stops);
    },
    runVisionCheck: (slot) => {
      if (closed) {
        return Promise.resolve({ passed: false, elapsedMs: 0, message: 'Сервер останавливается' });
      }
      const ac = new AbortController();
      const promise = runVisionCheck({
        runDir: ctx.runDir,
        childrenFile: ctx.childrenFile,
        fakeMode: ctx.fakeMode,
        api: ctx.api,
        slot,
        signal: ac.signal,
      }).finally(() => {
        ctx.activeVisionChecks.delete(ac);
      });
      ctx.activeVisionChecks.set(ac, promise);
      return promise;
    },
    getApiBaseUrl: () => ctx.api.baseUrl,
    async close() {
      closed = true;
      for (const ac of ctx.activeVisionChecks.keys()) {
        ac.abort();
      }
      await Promise.allSettled([this.stopAll('runner_closed'), ...ctx.activeVisionChecks.values()]);
      ctx.api.close();
    },
  };
}

export type { CustomBotLaunchBuilder } from './process.ts';
