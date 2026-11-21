import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSanitizedChildEnv } from '../../server/bots/adapters/shared.ts';
import { spawnManaged } from '../../server/proc/spawn.ts';
import { runPool } from '../../scripts/eval-bots/pool.ts';
import type { EffortLevel } from '../../shared/bot-tools.ts';

/**
 * One `claude -p` call with no MCP, settings or session, and a pool that runs such calls by key.
 * Used by the judges and by the ceiling test (docs/evals/detective-spike-3.md, Part B).
 */

export interface ModelCall {
  prompt: string;
  model: string;
  /** Read-only access to this folder; null gives the model no tools at all. */
  readDir: string | null;
  /** Omitted: the CLI's default effort, as the judges run. */
  effort?: EffortLevel | undefined;
}

export function modelCallCmd(call: ModelCall): string[] {
  const tools =
    call.readDir === null
      ? ['--tools', '']
      : ['--tools', 'Read', '--allowedTools', 'Read', '--add-dir', call.readDir];
  return [
    'claude',
    '-p',
    call.prompt,
    '--model',
    call.model,
    ...(call.effort === undefined ? [] : ['--effort', call.effort]),
    ...tools,
    '--strict-mcp-config',
    '--permission-mode',
    'bypassPermissions',
    '--setting-sources',
    '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--output-format',
    'json',
  ];
}

export async function runModelCall(call: ModelCall): Promise<{ text: string; usage: unknown }> {
  const cwd = mkdtempSync(path.join(tmpdir(), 'geo-call-'));
  try {
    const proc = spawnManaged({
      cmd: modelCallCmd(call),
      cwd,
      env: buildSanitizedChildEnv(),
      kind: 'bot',
    });
    const exit = await proc.exited;
    await proc.drained;
    if (exit.code !== 0) throw new Error(`model call exited ${exit.code ?? 'null'}`);
    const out = JSON.parse(proc.getStdout()) as { result?: string; usage?: unknown };
    return { text: out.result ?? '', usage: out.usage ?? null };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

export interface KeyedJobs<T> {
  keys: readonly string[];
  run: (key: string) => Promise<T>;
  describe: (key: string, result: T) => string;
  /** Log prefix, for example `judge`. */
  label: string;
  /** Results of an earlier, interrupted run: these keys are kept and not run again. */
  done?: ReadonlyMap<string, T>;
  concurrency?: number;
  /** Called once per new result, so a caller can store it at once. */
  onResult?: (key: string, result: T) => void;
}

/** Runs one job per key with one retry each; a job that fails twice is logged and skipped. */
export async function runKeyedJobs<T>(jobs: KeyedJobs<T>): Promise<Map<string, T>> {
  const done = jobs.done ?? new Map<string, T>();
  const results = new Map<string, T>(done);
  const tasks = jobs.keys
    .filter((key) => !done.has(key))
    .map((key) => async () => {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const res = await jobs.run(key);
          results.set(key, res);
          jobs.onResult?.(key, res);
          console.log(`[${jobs.label} ${key}] ${jobs.describe(key, res)}`);
          return;
        } catch (err) {
          console.error(`[${jobs.label} ${key}] attempt ${attempt}: ${String(err)}`);
        }
      }
    });
  await runPool(tasks, jobs.concurrency ?? 2, () => false);
  return results;
}
