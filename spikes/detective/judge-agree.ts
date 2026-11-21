import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argValue, optionalArg } from './judge-call.ts';
import type { JudgeArm } from './judge-extract.ts';
import {
  addVerdict,
  emptyCounts,
  newcombeDiff,
  withRates,
  type JudgedFinding,
} from './judge-stats.ts';

/**
 * Pools judge runs and measures how far two runs agree (docs/evals/detective-spike-3.md, Part A).
 *   bun run spikes/detective/judge-agree.ts --mode findings --runs <dirA>,<dirB> [--ref <dir>]
 *   bun run spikes/detective/judge-agree.ts --mode eyes --runs <dir> --ref <dir>
 * Add `--out <file>` to store the JSON. Runs are matched by content, not by the shuffled number.
 */

export interface JudgedItem {
  /** Stable across runs: built from the spot, the round and the judged text. */
  id: string;
  group: string;
  verdict: string | undefined;
}

interface FindingItem extends JudgedItem {
  group: JudgeArm;
  finding: JudgedFinding | undefined;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

/** Appends an occurrence number, so two identical texts of one round stay two items. */
function uniqueIds(bases: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return bases.map((base) => {
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return `${base}#${k}`;
  });
}

type StoredVerdicts<T> = Record<string, { verdicts: T[] }>;

export function loadFindingRun(dir: string): FindingItem[] {
  const key = readJson(path.join(dir, 'blind-key.json')) as Array<{
    spotId: string;
    n: number;
    arm: JudgeArm;
    executionId: string;
  }>;
  const sheet = readJson(path.join(dir, 'blind-sheet.json')) as Array<{
    spotId: string;
    n: number;
    text: string;
  }>;
  const stored = readJson(path.join(dir, 'verdicts.json')) as StoredVerdicts<JudgedFinding>;
  const textOf = new Map(sheet.map((s) => [`${s.spotId}|${s.n}`, s.text]));
  const ids = uniqueIds(
    key.map(
      (k) => `${k.spotId}|${k.arm}|${k.executionId}|${textOf.get(`${k.spotId}|${k.n}`) ?? ''}`,
    ),
  );
  return key.map((k, i) => {
    const finding = stored[k.spotId]?.verdicts.find((v) => v.n === k.n);
    return { id: ids[i] ?? '', group: k.arm, verdict: finding?.verdict, finding };
  });
}

export function loadEyesRun(dir: string): JudgedItem[] {
  const key = readJson(path.join(dir, 'eyes-key.json')) as Array<{
    n: number;
    spotId: string;
    executionId: string;
    askIndex: number;
    kind: string;
    question: string;
    status: string;
  }>;
  const stored = readJson(path.join(dir, 'eyes-verdicts.json')) as StoredVerdicts<{
    n: number;
    verdict: string;
  }>;
  const ids = uniqueIds(
    key.map((k) => `${k.spotId}|${k.executionId}|${k.askIndex}|${k.kind}|${k.question}`),
  );
  return key.map((k, i) => ({
    id: ids[i] ?? '',
    group: `${k.kind}:${k.status}`,
    verdict: stored[k.spotId]?.verdicts.find((v) => v.n === k.n)?.verdict,
  }));
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Reports name a run by its folder, never by a full local path. */
const label = (dir: string | undefined): string => path.basename(dir ?? '');

/** Item-by-item agreement of two runs; `flag` is the verdict whose overlap is reported. */
export function agreementOf(a: readonly JudgedItem[], b: readonly JudgedItem[], flag: string) {
  const other = new Map(b.map((item) => [item.id, item.verdict]));
  const matrix: Record<string, number> = {};
  const flagged = { first: 0, second: 0, both: 0 };
  let common = 0;
  let same = 0;
  for (const item of a) {
    const theirs = other.get(item.id);
    if (item.verdict === undefined || theirs === undefined) continue;
    common += 1;
    if (item.verdict === theirs) same += 1;
    const cell = `${item.verdict}->${theirs}`;
    matrix[cell] = (matrix[cell] ?? 0) + 1;
    if (item.verdict === flag) flagged.first += 1;
    if (theirs === flag) flagged.second += 1;
    if (item.verdict === flag && theirs === flag) flagged.both += 1;
  }
  return { common, same, agreement: common === 0 ? null : r3(same / common), matrix, flagged };
}

/**
 * Shares pooled over several runs of the same findings. The interval of the difference uses the
 * number of distinct findings, not of verdicts: two verdicts on one finding are not independent.
 */
export function poolFindings(runs: ReadonlyArray<readonly FindingItem[]>) {
  const counts = { detective: emptyCounts(), single: emptyCounts() };
  for (const run of runs) for (const item of run) addVerdict(counts[item.group], item.finding);
  const detective = withRates(counts.detective);
  const single = withRates(counts.single);
  const n = Math.max(1, runs.length);
  const detectiveMinusSingle = newcombeDiff(
    detective.unsupported / n,
    detective.judged / n,
    single.unsupported / n,
    single.judged / n,
  );
  return { runs: runs.length, detective, single, detectiveMinusSingle };
}

function findingsReport(runDirs: readonly string[], refDir: string | null) {
  const runs = runDirs.map(loadFindingRun);
  const ref = refDir === null ? null : loadFindingRun(refDir);
  const pairs = runs.flatMap((a, i) =>
    runs.slice(i + 1).map((b, j) => ({
      first: label(runDirs[i]),
      second: label(runDirs[i + 1 + j]),
      ...agreementOf(a, b, 'unsupported'),
    })),
  );
  const perRun = runs.map((run, i) => ({ run: label(runDirs[i]), ...poolFindings([run]) }));
  const againstRef =
    ref === null
      ? []
      : runs.map((run, i) => ({ run: label(runDirs[i]), ...agreementOf(ref, run, 'unsupported') }));
  return { pooled: poolFindings(runs), perRun, betweenRuns: pairs, againstRef };
}

function eyesReport(runDirs: readonly string[], refDir: string | null) {
  const runs = runDirs.map(loadEyesRun);
  const ref = refDir === null ? null : loadEyesRun(refDir);
  if (ref === null) return { againstRef: [] };
  const groups = [...new Set(ref.map((item) => item.group))].sort();
  return {
    againstRef: runs.map((run, i) => ({
      run: label(runDirs[i]),
      ...agreementOf(ref, run, 'wrong'),
      byGroup: Object.fromEntries(
        groups.map((g) => [
          g,
          agreementOf(
            ref.filter((item) => item.group === g),
            run,
            'wrong',
          ),
        ]),
      ),
    })),
  };
}

function main(): number {
  const argv = Bun.argv.slice(2);
  const mode = argValue(argv, '--mode');
  const runDirs = argValue(argv, '--runs')
    .split(',')
    .map((d) => path.resolve(d));
  const refArg = optionalArg(argv, '--ref');
  const refDir = refArg === null ? null : path.resolve(refArg);
  if (mode !== 'findings' && mode !== 'eyes') throw new Error(`bad --mode ${mode}`);
  const report =
    mode === 'findings' ? findingsReport(runDirs, refDir) : eyesReport(runDirs, refDir);
  const text = `${JSON.stringify({ mode, ...report }, null, 2)}\n`;
  const out = optionalArg(argv, '--out');
  if (out !== null) writeFileSync(path.resolve(out), text);
  console.log(text);
  return 0;
}

if (import.meta.main) process.exit(main());
