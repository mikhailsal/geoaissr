import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { HarnessId } from '../../shared/storage-schemas.ts';
import { formatStderrTail, type ServerLogger } from '../log.ts';
import { spawnManaged, type ManagedProcess } from '../proc/spawn.ts';
import { getHarnessAdapter } from './adapters/index.ts';
import { buildSanitizedChildEnv } from './adapters/shared.ts';
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
}): void {
  void opts.proc.exited
    .then((exitInfo) => {
      if (opts.handle.stopped) return;
      try {
        reportBotExit(opts, exitInfo);
      } finally {
        cleanupBotHandle(opts.api, opts.activeHandles, opts.handle);
      }
    })
    .catch((err: unknown) => {
      opts.logger?.log('harness_monitor_error', {
        slotId: opts.handle.slotId,
        message: err instanceof Error ? err.message : String(err),
      });
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
  opts.logger?.log('harness_end', {
    slotId: opts.handle.slotId,
    harness: opts.harnessName,
    roundNumber: opts.handle.roundNumber,
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
    diagnosticsTail: aborted && tail.length > 0 ? tail.join('\n') : undefined,
  });
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

    opts.logger?.registerSecrets([], [opts.handle.token]);
    const startedAtMs = Date.now();
    opts.logger?.log('harness_start', {
      slotId: opts.slot.id,
      harness: opts.slot.harness,
      roundNumber: opts.roundNumber,
      argv: spec.cmd,
    });

    const proc = spawnManaged({
      cmd: spec.cmd,
      cwd: path.resolve(spec.cwd),
      env: buildSanitizedChildEnv(),
      stdinText: spec.stdinText,
      kind: 'bot',
      childrenFile: opts.childrenFile,
    });
    opts.handle.proc = proc;
    attachBotProcessMonitor({
      proc,
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
    const detail = err instanceof Error ? err.message : String(err);
    cleanupBotHandle(opts.api, opts.activeHandles, opts.handle);
    opts.dispatch({
      type: 'bot_finished',
      matchId: opts.handle.matchId,
      gen: opts.handle.gen,
      roundNumber: opts.roundNumber,
      botId: opts.handle.slotId,
      aborted: true,
      reason: 'сбой запуска',
      diagnosticsTail: detail.slice(-300),
    });
  }
}

export function cleanEmptyWorkDir(dir: string): boolean {
  return existsSync(dir);
}
