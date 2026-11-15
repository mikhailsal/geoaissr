import { spawn, type ChildProcess } from 'node:child_process';
import { getProcessStartTime } from './lock.ts';
import { killProcessGroup, registerChildRecord, unregisterChildRecord } from './registry.ts';

export interface SpawnManagedOptions {
  cmd: readonly string[];
  cwd: string;
  env?: Record<string, string>;
  stdinText?: string;
  kind: string;
  childrenFile?: string;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}

export interface ManagedProcess {
  readonly pid: number;
  readonly command: string;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  getStdout: () => string;
  getStderr: () => string;
  stop: (graceMs?: number) => Promise<void>;
}

const activeHandles = new Set<ManagedProcess>();
let exitHooksInstalled = false;

export function installProcessExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.on('exit', () => {
    for (const handle of activeHandles) {
      if (handle.pid <= 0) continue;
      try {
        process.kill(-handle.pid, 'SIGKILL');
      } catch {
        // ignore if already gone
      }
    }
  });
}

export async function stopAllManagedProcesses(graceMs = 1500): Promise<void> {
  const handles = [...activeHandles];
  await Promise.all(handles.map((h) => h.stop(graceMs)));
}

/**
 * Reap leftovers (MCP bridges, shells) a leader started after it exits on its own. The group id
 * cannot be reused while any member is alive, so this cannot hit an unrelated process.
 */
function reapProcessGroup(pid: number): void {
  if (pid <= 0) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Group already empty.
  }
}

/** Long-lived children (cloudflared) must not grow these buffers without bound. */
const MAX_CAPTURED_OUTPUT = 256 * 1024;

function keepTail(text: string): string {
  return text.length > MAX_CAPTURED_OUTPUT ? text.slice(-MAX_CAPTURED_OUTPUT) : text;
}

function attachStreamReaders(
  child: ChildProcess,
  opts: SpawnManagedOptions,
): { getStdout: () => string; getStderr: () => string } {
  let stdoutAcc = '';
  let stderrAcc = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdoutAcc = keepTail(stdoutAcc + chunk);
    opts.onStdoutChunk?.(chunk);
  });
  child.stderr?.on('data', (chunk: string) => {
    stderrAcc = keepTail(stderrAcc + chunk);
    opts.onStderrChunk?.(chunk);
  });
  return {
    getStdout: () => stdoutAcc,
    getStderr: () => stderrAcc,
  };
}

export function spawnManaged(opts: SpawnManagedOptions): ManagedProcess {
  installProcessExitHooks();
  const [command, ...args] = opts.cmd;
  if (!command) throw new Error('spawnManaged: empty cmd');

  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    stdio: [opts.stdinText !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  if (opts.stdinText !== undefined && child.stdin) {
    child.stdin.on('error', () => {
      // Ignore EPIPE when child exits before consuming stdin or fails to spawn.
    });
    child.stdin.write(opts.stdinText);
    child.stdin.end();
  }

  const pid = child.pid ?? 0;
  if (pid > 0 && opts.childrenFile) {
    const startTime = getProcessStartTime(pid) ?? String(Date.now());
    registerChildRecord(opts.childrenFile, {
      pid,
      startTime,
      command,
      kind: opts.kind,
    });
  }

  const streams = attachStreamReaders(child, opts);
  let handle: ManagedProcess | null = null;

  const forget = (): void => {
    if (handle) activeHandles.delete(handle);
    if (pid > 0 && opts.childrenFile) unregisterChildRecord(opts.childrenFile, pid);
  };
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => {
      reapProcessGroup(pid);
      forget();
      resolve({ code, signal });
    });
    child.on('error', () => {
      forget();
      resolve({ code: 1, signal: null });
    });
  });

  let stopping: Promise<void> | null = null;
  handle = {
    pid,
    command,
    exited,
    getStdout: streams.getStdout,
    getStderr: streams.getStderr,
    stop: async (graceMs = 2000) => {
      if (stopping) return stopping;
      stopping = (async () => {
        if (pid > 0) {
          await killProcessGroup(pid, graceMs);
        }
        await exited;
      })();
      return stopping;
    },
  };

  if (pid > 0) activeHandles.add(handle);
  return handle;
}
