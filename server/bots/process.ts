import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { BotCostEstimate, BotTokenUsage } from '../../shared/bot-results.ts';
import { createUsageParser } from './usage.ts';
import type { HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { HarnessId } from '../../shared/storage-schemas.ts';
import { redactSecrets } from '../errors.ts';
import { formatStderrTail, type ServerLogger } from '../log.ts';
import { spawnManaged, type ManagedProcess } from '../proc/spawn.ts';
import { getHarnessAdapter } from './adapters/index.ts';
import { buildSanitizedChildEnv } from './adapters/shared.ts';
import { logAgyToolAttempts, logBotDiagnostic } from './diagnostics.ts';
import type { BotToolApiServer } from './api.ts';
import type { EngineEvent, RoundTarget } from '../engine/types.ts';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';

export type CustomBotLaunchBuilder = (params: {
  slot: BotSlotConfig;
  workDir: string;
  apiUrl: string;
  botToken: string;
  prompt: string;
}) => { cmd: string[]; cwd: string; stdinText?: string };

export interface ActiveBotHandle {
  matchId: string;
  gen: number;
  roundNumber: number;
  slotId: string;
  workDir: string;
  token: string;
  abortQueue: (reason: string) => void;
  proc?: ManagedProcess;
  stopped: boolean;
  releaseObserve: () => void;
  setStartedAt: (ms: number) => void;
  flushDiagnostics?: () => void;
}

export function cleanDirSafe(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore already-deleted ephemeral workspace.
  }
}

export function cleanupBotHandle(
  api: BotToolApiServer,
  activeHandles: Map<string, ActiveBotHandle>,
  handle: ActiveBotHandle,
): void {
  handle.stopped = true;
  handle.releaseObserve();
  handle.abortQueue('stopped');
  api.unregisterBot(handle.token);
  const flush = handle.flushDiagnostics;
  handle.flushDiagnostics = undefined;
  try {
    flush?.();
  } catch {
    // Optional diagnostics must not prevent cleanup.
  }
  cleanDirSafe(handle.workDir);
  if (activeHandles.get(handle.slotId) === handle) {
    activeHandles.delete(handle.slotId);
  }
}

export function createGatePair(): {
  waitObserveRelease: (signal: AbortSignal) => Promise<void>;
  releaseObserve: () => void;
  waitOnce: () => Promise<void>;
} {
  let released = false;
  const waiters: Array<() => void> = [];
  const waitObserveRelease = (signal: AbortSignal): Promise<void> => {
    if (released || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const onAbort = (): void => {
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      waiters.push(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  };
  const waitOnce = (): Promise<void> => {
    if (released) return Promise.resolve();
    return new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  };
  const releaseObserve = (): void => {
    released = true;
    while (waiters.length > 0) waiters.shift()?.();
  };
  return { waitObserveRelease, releaseObserve, waitOnce };
}

export function resolveInstalledCliVersions(
  harnesses: readonly HarnessCatalogEntry[],
): Partial<Record<HarnessId, string>> {
  const out: Partial<Record<HarnessId, string>> = {};
  for (const h of harnesses) {
    if (!h.available) continue;
    const bin = h.id;
    const res = Bun.spawnSync([bin, '--version'], { stdout: 'pipe', stderr: 'ignore' });
    const txt = new TextDecoder().decode(res.stdout).trim().split(/\r?\n/)[0];
    if (res.exitCode === 0 && txt) out[h.id] = txt;
  }
  return out;
}

function attachBotProcessMonitor(opts: {
  proc: ManagedProcess;
  api: BotToolApiServer;
  activeHandles: Map<string, ActiveBotHandle>;
  handle: ActiveBotHandle;
  harnessName: string;
  startedAtMs: number;
  didSubmitGuess: () => boolean;
  dispatch: (event: EngineEvent) => void;
  logger?: ServerLogger;
  parser: ReturnType<typeof createUsageParser>;
  model: string;
  estimateCost?: (model: string, usage: BotTokenUsage) => Promise<BotCostEstimate>;
}): void {
  void opts.proc.exited
    .then(async (exitInfo) => {
      await opts.proc.drained;
      try {
        recordBotAccounting(opts);
      } catch (err) {
        logBotDiagnostic(opts.logger, 'harness_monitor_error', {
          ...botLogIdentity(opts),
          phase: 'accounting',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (opts.handle.stopped) {
        logBotDiagnostic(opts.logger, 'harness_end', {
          ...botLogIdentity(opts),
          durationMs: Date.now() - opts.startedAtMs,
          exitCode: exitInfo.code,
          signal: exitInfo.signal,
          stopped: true,
        });
        return;
      }
      try {
        reportBotExit(opts, exitInfo);
      } finally {
        cleanupBotHandle(opts.api, opts.activeHandles, opts.handle);
      }
    })
    .catch((err: unknown) => {
      logBotDiagnostic(opts.logger, 'harness_monitor_error', {
        ...botLogIdentity(opts),
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

function botLogIdentity(opts: Parameters<typeof attachBotProcessMonitor>[0]) {
  return {
    matchId: opts.handle.matchId,
    gen: opts.handle.gen,
    roundNumber: opts.handle.roundNumber,
    slotId: opts.handle.slotId,
    harness: opts.harnessName,
    model: opts.model,
  };
}

function recordBotAccounting(opts: Parameters<typeof attachBotProcessMonitor>[0]): void {
  const tokenUsage = opts.parser.finish();
  logBotDiagnostic(opts.logger, 'harness_usage', {
    ...botLogIdentity(opts),
    ...opts.parser.getDiagnostics(),
    rawCounterScope: opts.harnessName === 'codex' ? 'last-turn' : 'terminal',
    tokenUsage: tokenUsage ?? null,
  });
  if (!tokenUsage) return;
  const identity = {
    matchId: opts.handle.matchId,
    gen: opts.handle.gen,
    roundNumber: opts.handle.roundNumber,
    botId: opts.handle.slotId,
  };
  opts.dispatch({ type: 'bot_accounting', ...identity, accounting: { tokenUsage, costUsd: null } });
  if (!opts.estimateCost) return;
  void Promise.resolve()
    .then(() => opts.estimateCost?.(opts.model, tokenUsage))
    .then((estimate) => {
      if (!estimate) return;
      logBotDiagnostic(opts.logger, 'harness_cost', { ...botLogIdentity(opts), ...estimate });
      opts.dispatch({
        type: 'bot_accounting',
        ...identity,
        accounting: { tokenUsage, ...estimate },
      });
    })
    .catch((err: unknown) => {
      logBotDiagnostic(opts.logger, 'harness_cost', {
        ...botLogIdentity(opts),
        costUsd: null,
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Masks secrets in text that is about to enter the room state, and so reach the host's screen.
 * The logger knows the keys and invite tokens. The bot's own token is passed explicitly because
 * a launch that failed early never got as far as registering it.
 */
export function maskDiagnostics(text: string, botToken: string, logger?: ServerLogger): string {
  const known = logger ? logger.redact(text) : text;
  return redactSecrets(known, [], botToken ? [botToken] : []);
}

/** Reports a bot whose launch itself failed (no process ran), with the cause masked and clipped. */
export function dispatchBotLaunchFailure(opts: {
  dispatch: (event: EngineEvent) => void;
  matchId: string;
  gen: number;
  roundNumber: number;
  botId: string;
  /** The bot's own token, when one had already been issued at the point of failure. */
  token?: string;
  err: unknown;
  logger?: ServerLogger;
}): void {
  const detail = opts.err instanceof Error ? opts.err.message : String(opts.err);
  // Mask first, then clip: clipping first could cut a secret in half and leave a readable part.
  const masked = maskDiagnostics(detail, opts.token ?? '', opts.logger);
  logBotDiagnostic(opts.logger, 'harness_monitor_error', {
    phase: 'launch',
    matchId: opts.matchId,
    gen: opts.gen,
    roundNumber: opts.roundNumber,
    slotId: opts.botId,
    message: masked,
  });
  opts.dispatch({
    type: 'bot_finished',
    matchId: opts.matchId,
    gen: opts.gen,
    roundNumber: opts.roundNumber,
    botId: opts.botId,
    aborted: true,
    reason: 'сбой запуска',
    diagnosticsTail: masked.slice(-300),
  });
}

function reportBotExit(
  opts: Parameters<typeof attachBotProcessMonitor>[0],
  exitInfo: { code: number | null; signal: NodeJS.Signals | null },
): void {
  const submitted = opts.didSubmitGuess();
  const tail = formatStderrTail(opts.proc.getStderr(), 50);
  const codeNum = exitInfo.code ?? -1;
  const aborted = exitInfo.code !== 0 || !submitted;
  const reason = submitted
    ? 'завершил ход'
    : exitInfo.code !== 0
      ? `ошибка процесса (код ${codeNum})`
      : 'вышел без ответа';
  logBotDiagnostic(opts.logger, 'harness_end', {
    ...botLogIdentity(opts),
    durationMs: Date.now() - opts.startedAtMs,
    exitCode: exitInfo.code,
    signal: exitInfo.signal,
    aborted,
    reason,
    stderrTail: tail,
  });
  opts.dispatch({
    type: 'bot_finished',
    matchId: opts.handle.matchId,
    gen: opts.handle.gen,
    roundNumber: opts.handle.roundNumber,
    botId: opts.handle.slotId,
    aborted,
    reason,
    diagnosticsTail:
      aborted && tail.length > 0
        ? maskDiagnostics(tail.join('\n'), opts.handle.token, opts.logger)
        : undefined,
  });
}

function logBotStart(
  opts: {
    logger?: ServerLogger;
    handle: ActiveBotHandle;
    slot: BotSlotConfig;
    roundNumber: number;
  },
  argv?: string[],
): number {
  try {
    opts.logger?.registerSecrets([], [opts.handle.token]);
  } catch {
    // Diagnostic setup must not prevent a bot from launching.
  }
  const startedAtMs = Date.now();
  logBotDiagnostic(opts.logger, 'harness_start', {
    matchId: opts.handle.matchId,
    gen: opts.handle.gen,
    slotId: opts.slot.id,
    harness: opts.slot.harness,
    model: opts.slot.model,
    effort: opts.slot.effort,
    roundNumber: opts.roundNumber,
    command: argv?.[0],
    workDir: opts.handle.workDir,
  });
  return startedAtMs;
}

function attachAgyAudit(opts: Parameters<typeof spawnAndMonitorBotProcess>[0]): void {
  if (opts.slot.harness !== 'agy') return;
  opts.handle.flushDiagnostics = () => {
    logAgyToolAttempts(opts.logger, opts.handle.workDir, {
      matchId: opts.handle.matchId,
      gen: opts.handle.gen,
      roundNumber: opts.roundNumber,
      slotId: opts.slot.id,
      harness: opts.slot.harness,
      model: opts.slot.model,
    });
  };
}

export function spawnAndMonitorBotProcess(opts: {
  childrenFile: string;
  api: BotToolApiServer;
  activeHandles: Map<string, ActiveBotHandle>;
  handle: ActiveBotHandle;
  slot: BotSlotConfig;
  target: RoundTarget;
  roundNumber: number;
  moveEnabled: boolean;
  prompt: string;
  didSubmitGuess: () => boolean;
  dispatch: (event: EngineEvent) => void;
  logger?: ServerLogger;
  buildCustomLaunchSpec?: CustomBotLaunchBuilder;
  estimateCost?: (model: string, usage: BotTokenUsage) => Promise<BotCostEstimate>;
}): void {
  try {
    mkdirSync(opts.handle.workDir, { recursive: true });
    const adapter = getHarnessAdapter(opts.slot.harness);
    const spec = opts.buildCustomLaunchSpec
      ? opts.buildCustomLaunchSpec({
          slot: opts.slot,
          workDir: opts.handle.workDir,
          apiUrl: opts.api.baseUrl,
          botToken: opts.handle.token,
          prompt: opts.prompt,
        })
      : adapter.buildLaunchSpec({
          workDir: opts.handle.workDir,
          model: opts.slot.model,
          effort: opts.slot.effort,
          prompt: opts.prompt,
          apiUrl: opts.api.baseUrl,
          botToken: opts.handle.token,
          moveEnabled: opts.moveEnabled,
        });

    const startedAtMs = logBotStart(opts, spec.cmd);
    attachAgyAudit(opts);
    const parser = createUsageParser(opts.slot.harness);
    const proc = spawnManaged({
      cmd: spec.cmd,
      cwd: path.resolve(spec.cwd),
      env: buildSanitizedChildEnv(),
      stdinText: spec.stdinText,
      kind: 'bot',
      childrenFile: opts.childrenFile,
      onStdoutChunk: parser.push,
    });
    opts.handle.proc = proc;
    attachBotProcessMonitor({
      proc,
      parser,
      model: opts.slot.model,
      estimateCost: opts.estimateCost,
      api: opts.api,
      activeHandles: opts.activeHandles,
      handle: opts.handle,
      harnessName: opts.slot.harness,
      startedAtMs,
      didSubmitGuess: opts.didSubmitGuess,
      dispatch: opts.dispatch,
      logger: opts.logger,
    });
  } catch (err) {
    cleanupBotHandle(opts.api, opts.activeHandles, opts.handle);
    dispatchBotLaunchFailure({
      dispatch: opts.dispatch,
      matchId: opts.handle.matchId,
      gen: opts.handle.gen,
      roundNumber: opts.roundNumber,
      botId: opts.handle.slotId,
      token: opts.handle.token,
      err,
      logger: opts.logger,
    });
  }
}

export function cleanEmptyWorkDir(dir: string): boolean {
  return existsSync(dir);
}
