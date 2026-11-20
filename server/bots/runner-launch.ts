import { mkdirSync } from 'node:fs';
import { joinUnder } from '../paths.ts';
import { getHarnessAdapter } from './adapters/index.ts';
import { logBotDiagnostic } from './diagnostics.ts';
import { startMonitoredFakeBot } from './fake-bot.ts';
import { createMoveTracker } from './move.ts';
import {
  cleanupBotHandle,
  createGatePair,
  dispatchBotLaunchFailure,
  spawnAndMonitorBotProcess,
  type ActiveBotHandle,
} from './process.ts';
import { buildBotRoundPrompt } from './prompt.ts';
import { createBotToolQueue, type BotToolQueue } from './queue.ts';
import { buildRoundHandlers } from './runner-handlers.ts';
import { REGION_LABELS_RU, type RoundBotParams, type RunnerCtx } from './runner-types.ts';

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
      moveEnabled,
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

export function launchBotProcess(ctx: RunnerCtx, params: RoundBotParams): void {
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
    requireCompleteReasoning: true,
    onCorrection: (info) => {
      logBotDiagnostic(ctx.logger, 'bot_journal_correction', {
        matchId,
        gen,
        roundNumber,
        slotId: slot.id,
        harness: slot.harness,
        ...info,
      });
    },
    onDispatch: (audit) => {
      logBotDiagnostic(ctx.logger, 'bot_tool_call', {
        matchId,
        gen,
        roundNumber,
        slotId: slot.id,
        ...audit,
        ok: audit.result ? !audit.result.isError : false,
      });
    },
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
export function dispatchLaunchFailure(
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

export async function stopBotHandle(
  ctx: RunnerCtx,
  h: ActiveBotHandle,
  reason: string,
): Promise<void> {
  h.stopped = true;
  h.abortQueue(reason);
  // Swallow stop failures: callers fire-and-forget this, and cleanup must still run.
  await h.proc?.stop(500).catch(() => undefined);
  cleanupBotHandle(ctx.api, ctx.activeHandles, h);
}
