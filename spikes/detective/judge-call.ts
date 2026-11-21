import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSanitizedChildEnv } from '../../server/bots/adapters/shared.ts';
import { spawnManaged } from '../../server/proc/spawn.ts';
import { runPool } from '../../scripts/eval-bots/pool.ts';

/**
 * One model-judge call: `claude -p` with read-only access to the dataset frames and no MCP,
 * settings or session. Shared by the unsupported-finding judge and the eyes-answer judge.
 */

export const JUDGE_MODEL = 'claude-sonnet-5-5';

export function argValue(argv: readonly string[], flag: string): string {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (!v) throw new Error(`missing ${flag}`);
  return v;
}

export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('judge reply has no JSON object');
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

export async function runJudgeCall(
  prompt: string,
  datasetDir: string,
): Promise<{ text: string; usage: unknown }> {
  const cwd = mkdtempSync(path.join(tmpdir(), 'geo-judge-'));
  try {
    const proc = spawnManaged({
      cmd: [
        'claude',
        '-p',
        prompt,
        '--model',
        JUDGE_MODEL,
        '--tools',
        'Read',
        '--allowedTools',
        'Read',
        '--add-dir',
        datasetDir,
        '--strict-mcp-config',
        '--permission-mode',
        'bypassPermissions',
        '--setting-sources',
        '',
        '--no-session-persistence',
        '--disable-slash-commands',
        '--output-format',
        'json',
      ],
      cwd,
      env: buildSanitizedChildEnv(),
      kind: 'bot',
    });
    const exit = await proc.exited;
    await proc.drained;
    if (exit.code !== 0) throw new Error(`judge exited ${exit.code ?? 'null'}`);
    const out = JSON.parse(proc.getStdout()) as { result?: string; usage?: unknown };
    return { text: out.result ?? '', usage: out.usage ?? null };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** Runs one job per spot, two at a time, with one retry each; failures are logged and skipped. */
export async function judgeEachSpot<T>(
  spotIds: readonly string[],
  judge: (spotId: string) => Promise<T>,
  describe: (spotId: string, result: T) => string,
): Promise<Map<string, T>> {
  const results = new Map<string, T>();
  const jobs = spotIds.map((spotId) => async () => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await judge(spotId);
        results.set(spotId, res);
        console.log(`[judge ${spotId}] ${describe(spotId, res)}`);
        return;
      } catch (err) {
        console.error(`[judge ${spotId}] attempt ${attempt}: ${String(err)}`);
      }
    }
  });
  await runPool(jobs, 2, () => false);
  return results;
}
