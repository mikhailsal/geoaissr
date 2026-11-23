import { mkdirSync } from 'node:fs';
import type { DetectiveRole } from '../../../shared/detective-tools.ts';
import { joinUnder } from '../../paths.ts';
import type { BotToolEndpoint } from '../api.ts';
import { logBotDiagnostic } from '../diagnostics.ts';
import { createMoveTracker } from '../move.ts';
import { cleanupBotHandle, createGatePair, type ActiveBotHandle } from '../process.ts';
import { effectiveRemainingSec } from '../runner-handlers.ts';
import type { RoundBotParams, RunnerCtx } from '../runner-types.ts';
import { startFakeDetective } from './fake.ts';
import { startDetectiveProcesses } from './monitor.ts';
import type { DetectiveRun } from './run.ts';
import { createDetectiveSession, type DetectiveSession } from './session.ts';
import { errorReply, type DetectiveSink } from './state.ts';

/**
 * Launches a bot that plays the Detective style: two processes per round. The «eyes» see the
 * frames and describe them, the «brain» reads only text and guesses. This module owns what the two
 * share: the session, both tokens, the work directory and the cleanup.
 */

/** Turns what the session reports into engine events for the journal and the score. */
function engineSink(ctx: RunnerCtx, params: RoundBotParams): DetectiveSink {
  const { matchId, gen, roundNumber, slot } = params;
  const ids = { matchId, gen, roundNumber, botId: slot.id };
  return {
    frame: (thumb) => {
      ctx.dispatch({ type: 'bot_thumb_added', ...ids, thumb });
    },
    turns: (turnsUsed) => {
      ctx.dispatch({ type: 'bot_turns_updated', ...ids, turnsUsed });
    },
    step: (turn, patch) => {
      ctx.dispatch({ type: 'bot_step_patched', ...ids, turn, patch });
    },
    finding: ({ turn, ...rest }) => {
      ctx.dispatch({ type: 'bot_finding', ...ids, turn, ...rest });
    },
    guess: (guess, finalized) => {
      ctx.dispatch({ type: 'bot_guess_recorded', ...ids, guess, finalized });
    },
    correction: (info) => {
      logBotDiagnostic(ctx.logger, 'bot_journal_correction', {
        matchId,
        gen,
        roundNumber,
        slotId: slot.id,
        harness: slot.harness,
        ...info,
      });
    },
  };
}

/** The tool endpoint of one role: every call is logged, and a crash becomes an error reply. */
function roleEndpoint(
  ctx: RunnerCtx,
  params: RoundBotParams,
  session: DetectiveSession,
  role: DetectiveRole,
): BotToolEndpoint {
  const { matchId, gen, roundNumber, slot } = params;
  return {
    async dispatch(tool, args) {
      const startedAt = Date.now();
      let ok = false;
      let error: string | undefined;
      try {
        const reply = await session.call(role, tool, args);
        ok = !reply.isError;
        return reply;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        return errorReply(`Внутренняя ошибка сервера: ${error}`);
      } finally {
        logBotDiagnostic(ctx.logger, 'bot_tool_call', {
          matchId,
          gen,
          roundNumber,
          slotId: slot.id,
          role,
          tool,
          args,
          durationMs: Date.now() - startedAt,
          ok,
          ...(error !== undefined ? { error } : {}),
        });
      }
    },
  };
}

function createRun(ctx: RunnerCtx, params: RoundBotParams): DetectiveRun {
  const { matchId, gen, roundNumber, target, slot, moveEnabled } = params;
  const workDir = joinUnder(ctx.runDir, matchId, `r${roundNumber}-g${gen}`, slot.id);
  mkdirSync(workDir, { recursive: true });
  const canMove = moveEnabled && slot.moveLimit > 0;
  const clock: { startedAt: number; deadlineAt: number | null } = {
    startedAt: Date.now(),
    deadlineAt: null,
  };
  const gate = createGatePair();
  const session = createDetectiveSession({
    imageService: ctx.imageService,
    tracker: createMoveTracker({
      initial: target,
      moveEnabled: canMove,
      fakeMode: ctx.fakeMode,
      locationService: ctx.locationService,
    }),
    target,
    imageSize: slot.imageSize,
    moveLimit: slot.moveLimit,
    moveEnabled: canMove,
    getRemainingMs: () =>
      effectiveRemainingSec({
        budgetSec: slot.budgetSec,
        startedAt: clock.startedAt,
        roundDeadlineAt: clock.deadlineAt,
        now: Date.now(),
      }) * 1000,
    waitStart: gate.waitObserveRelease,
    sink: engineSink(ctx, params),
  });
  const tokens = {
    brain: ctx.api.registerBot(roleEndpoint(ctx, params, session, 'brain')),
    eyes: ctx.api.registerBot(roleEndpoint(ctx, params, session, 'eyes')),
  };
  const handle: ActiveBotHandle = {
    matchId,
    gen,
    roundNumber,
    slotId: slot.id,
    workDir,
    token: tokens.brain,
    extraTokens: [tokens.eyes],
    abortQueue: () => {
      session.end();
    },
    stopped: false,
    releaseObserve: gate.releaseObserve,
    setStartedAt: (ms) => {
      clock.startedAt = ms;
    },
    setRoundDeadline: (ms) => {
      clock.deadlineAt = ms;
    },
  };
  return { ctx, params, handle, session, canMove, tokens, usage: {}, usageSeq: 0 };
}

/**
 * Registers the bot and starts its two roles. Throws when a role cannot be started (a broken
 * prompt file, a full disk); the handle is cleaned up first, and the caller reports the failure.
 */
export function launchDetectiveBot(
  ctx: RunnerCtx,
  params: RoundBotParams,
  supersede: (prev: ActiveBotHandle) => void,
): ActiveBotHandle {
  const run = createRun(ctx, params);
  const prev = ctx.activeHandles.get(params.slot.id);
  if (prev) supersede(prev);
  ctx.activeHandles.set(params.slot.id, run.handle);
  try {
    if (ctx.fakeMode && !ctx.buildCustomLaunchSpec) startFakeDetective(run);
    else startDetectiveProcesses(run);
  } catch (err) {
    const procs = run.handle.extraProcs ?? [];
    for (const proc of procs) void proc.stop(500).catch(() => undefined);
    cleanupBotHandle(ctx.api, ctx.activeHandles, run.handle);
    throw err;
  }
  return run.handle;
}
