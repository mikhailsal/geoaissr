import type { DetectiveRole } from '../../../shared/detective-tools.ts';
import { getRegionDiagonalKm } from '../../../shared/regions.ts';
import { getHarnessAdapter } from '../adapters/index.ts';
import { logBotDiagnostic } from '../diagnostics.ts';
import { cleanupBotHandle, dispatchBotLaunchFailure, maskDiagnostics } from '../process.ts';
import { REGION_LABELS_RU } from '../runner-types.ts';
import { attachAgyAudits } from './isolation.ts';
import { spawnRole, type RoleExit, type RoleProcess } from './procs.ts';
import { buildDetectiveBrainPrompt, buildDetectiveEyesPrompt } from './prompts.ts';
import {
  reportRoleUsage,
  roleEffort,
  roleModels,
  roleWorkDir,
  runIds,
  type DetectiveRun,
} from './run.ts';

/** Starts the two CLI processes of a Detective bot and follows them to their exits. */

/**
 * After the brain is done the eyes get this long to read «Раунд окончен» and exit on their own:
 * a CLI reports its token usage only when it exits normally. The bot counts as finished after
 * that, so the badge can show the tokens of both processes.
 */
export const EYES_GRACE_MS = 8_000;

function logIdentity(run: DetectiveRun, role: DetectiveRole | 'monitor'): Record<string, unknown> {
  const { matchId, gen, roundNumber, slot } = run.params;
  const harness = role === 'monitor' ? slot.harness : roleModels(slot)[role].harness;
  return { matchId, gen, roundNumber, slotId: slot.id, harness, role };
}

/** Read through a function: the engine can stop the bot during any await. */
function wasStopped(run: DetectiveRun): boolean {
  return run.handle.stopped;
}

function maskTail(run: DetectiveRun, lines: readonly string[]): string {
  const once = maskDiagnostics(lines.join('\n'), run.tokens.brain, run.ctx.logger);
  return maskDiagnostics(once, run.tokens.eyes, run.ctx.logger);
}

function stopRun(run: DetectiveRun): void {
  const procs = run.handle.extraProcs ?? [];
  void Promise.all(procs.map((proc) => proc.stop(500).catch(() => undefined))).then(() => {
    cleanupBotHandle(run.ctx.api, run.ctx.activeHandles, run.handle);
  });
}

/** One of the two processes never started: the bot cannot play this round. */
function failLaunch(run: DetectiveRun, proc: RoleProcess): void {
  const { ctx } = run;
  const token = run.tokens[proc.role];
  dispatchBotLaunchFailure({
    dispatch: ctx.dispatch,
    ...runIds(run),
    token,
    err: new Error(`не удалось запустить процесс (${proc.role}): ${proc.proc.command}`),
    logger: ctx.logger,
  });
  run.handle.stopped = true;
  run.session.end();
  stopRun(run);
}

function logExit(run: DetectiveRun, exit: RoleExit, extra: Record<string, unknown>): void {
  const identity = logIdentity(run, exit.role);
  logBotDiagnostic(run.ctx.logger, 'harness_end', {
    ...identity,
    durationMs: exit.durationMs,
    exitCode: exit.code,
    signal: exit.signal,
    tokenUsage: exit.usage,
    ...extra,
  });
  // The same usage record as an Intuit bot writes: why the tokens of a role are missing, if they are.
  logBotDiagnostic(run.ctx.logger, 'harness_usage', {
    ...identity,
    model: roleModels(run.params.slot)[exit.role].model,
    ...exit.usageDiagnostics,
    rawCounterScope: identity.harness === 'codex' ? 'last-turn' : 'terminal',
    tokenUsage: exit.usage,
  });
}

function onEyesExit(run: DetectiveRun, eyes: RoleProcess, exit: RoleExit): void {
  reportRoleUsage(run, 'eyes', exit.usage);
  if (run.handle.stopped) {
    logExit(run, exit, { stopped: true });
    return;
  }
  if (!exit.started) {
    failLaunch(run, eyes);
    return;
  }
  const early = !run.session.state.final && !run.session.state.ended;
  // Without the eyes the brain learns nothing new: its pending and later asks settle at once.
  run.session.eyesExited();
  logExit(run, exit, {
    ...(early ? { early: true, stderrTail: maskTail(run, exit.stderrTail) } : {}),
  });
}

function brainOutcome(
  run: DetectiveRun,
  exit: RoleExit,
): { aborted: boolean; reason: string; diagnosticsTail?: string } {
  const submitted = run.session.submittedGuess();
  const aborted = exit.code !== 0 || !submitted;
  const reason = submitted
    ? 'завершил ход'
    : exit.code !== 0
      ? `ошибка процесса (код ${exit.code ?? -1})`
      : 'вышел без ответа';
  const tail = aborted && exit.stderrTail.length > 0 ? maskTail(run, exit.stderrTail) : undefined;
  return { aborted, reason, ...(tail !== undefined ? { diagnosticsTail: tail } : {}) };
}

/** Resolves when `promise` does or after `ms`, whichever comes first; leaves no timer behind. */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function onBrainExit(
  run: DetectiveRun,
  brain: RoleProcess,
  eyes: RoleProcess,
  exit: RoleExit,
  graceMs: number,
): Promise<void> {
  reportRoleUsage(run, 'brain', exit.usage);
  if (run.handle.stopped) {
    logExit(run, exit, { stopped: true });
    return;
  }
  if (!exit.started) {
    failLaunch(run, brain);
    return;
  }
  const outcome = brainOutcome(run, exit);
  logExit(run, exit, outcome);
  // The round is over for this bot whatever the brain did: the eyes are told to finish.
  run.session.end();
  await settleWithin(eyes.done, graceMs);
  await eyes.proc.stop(500).catch(() => undefined);
  await eyes.done;
  // The engine may have stopped the bot while the eyes were finishing; it has its outcome then.
  if (wasStopped(run)) return;
  run.ctx.dispatch({ type: 'bot_finished', ...runIds(run), ...outcome });
  cleanupBotHandle(run.ctx.api, run.ctx.activeHandles, run.handle);
}

export function startDetectiveProcesses(run: DetectiveRun, graceMs = EYES_GRACE_MS): void {
  const { ctx, params, handle } = run;
  const { slot, target } = params;
  const shared = { moveLimit: slot.moveLimit, canMove: run.canMove };
  const models = roleModels(slot);
  const brainPrompt = buildDetectiveBrainPrompt({
    ...shared,
    regionLabelRu: REGION_LABELS_RU[target.region],
    regionDiagonalKm: getRegionDiagonalKm(target.region),
    budgetSec: slot.budgetSec,
    personalityPreset: slot.personalityPreset,
    personalityText: slot.personalityText,
  });
  const eyesPrompt = buildDetectiveEyesPrompt({
    ...shared,
    fileDelivery: getHarnessAdapter(models.eyes.harness).deliveryMode === 'file',
  });
  try {
    ctx.logger?.registerSecrets([], [run.tokens.brain, run.tokens.eyes]);
  } catch {
    // Diagnostic setup must not prevent a bot from launching.
  }
  const spawn = (role: DetectiveRole, prompt: string): RoleProcess => {
    const effort = roleEffort(slot, role);
    logBotDiagnostic(ctx.logger, 'harness_start', {
      ...logIdentity(run, role),
      model: models[role].model,
      effort,
      playStyle: 'detective',
    });
    const proc = spawnRole(ctx, params, {
      ...models[role],
      role,
      workDir: roleWorkDir(handle.workDir, role),
      token: run.tokens[role],
      prompt,
      effort,
      canMove: run.canMove,
    });
    handle.extraProcs = [...(handle.extraProcs ?? []), proc.proc];
    return proc;
  };
  attachAgyAudits(run);
  const eyes = spawn('eyes', eyesPrompt);
  const brain = spawn('brain', brainPrompt);
  const logFailure = (err: unknown): void => {
    logBotDiagnostic(ctx.logger, 'harness_monitor_error', {
      ...logIdentity(run, 'monitor'),
      message: err instanceof Error ? err.message : String(err),
    });
  };
  void eyes.done
    .then((exit) => {
      onEyesExit(run, eyes, exit);
    })
    .catch(logFailure);
  void brain.done.then((exit) => onBrainExit(run, brain, eyes, exit, graceMs)).catch(logFailure);
}
