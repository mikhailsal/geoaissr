import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { seenClaimBar } from './judge-bar5.ts';
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
 * The report holds counts and shares only: no text of a finding, and a run is named by its folder.
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
const label = (dir: string): string => path.basename(dir);

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

/** `agreementOf` over every item of the first run, and again inside each of its groups. */
export function agreementByGroup(a: readonly JudgedItem[], b: readonly JudgedItem[], flag: string) {
  const groups = [...new Set(a.map((item) => item.group))].sort();
  const inGroup = (group: string) =>
    agreementOf(
      a.filter((item) => item.group === group),
      b,
      flag,
    );
  return {
    ...agreementOf(a, b, flag),
    byGroup: Object.fromEntries(groups.map((group) => [group, inGroup(group)])),
  };
}

/**
 * Post-hoc split of the judge's claims by keyword (report of Part A in
 * docs/evals/detective-spike-3.md). `not_seen`: the claim says that something is absent, not
 * visible or unreadable. `frame`: the claim names a frame, a zoom or a heading. `seen`: every
 * other claim. It reads the judge's wording of a claim, English or Russian. It is a heuristic,
 * not a verdict of the judge: «white window frames» counts as `frame`, «без разметки» as `seen`.
 */
export type ClaimKind = 'seen' | 'not_seen' | 'frame';

// `\b` knows only ASCII letters, so the word edges are spelled out for Cyrillic.
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])';
const EDGE_AFTER = '(?![\\p{L}\\p{N}_])';
const NOT_SEEN_WORDS = new RegExp(
  `${EDGE_BEFORE}(?:no|not|none|нет)${EDGE_AFTER}|n't|unreadable|illegible|unclear|cannot|can't|absence|without|не вид|не чита|не разобр|не прочит|отсутств|нечитаем|неразборч|не удалось|не подтвержд|не замет|не найден|не обнаруж|не появ|не дал`,
  'iu',
);
const FRAME_WORDS = new RegExp(`frame|кадр|${EDGE_BEFORE}look${EDGE_AFTER}|zoom|приближ|°`, 'iu');

export function claimKind(text: string): ClaimKind {
  if (NOT_SEEN_WORDS.test(text)) return 'not_seen';
  return FRAME_WORDS.test(text) ? 'frame' : 'seen';
}

interface KindTally {
  ok: number;
  wrong: number;
  unclear: number;
}

const withError = (t: KindTally) => ({
  ...t,
  errorRate: t.ok + t.wrong === 0 ? null : r3(t.wrong / (t.ok + t.wrong)),
});

/**
 * The keyword split over the findings of one arm: marks per claim kind, and what the unsupported
 * findings rest on. Null when the run has no claim marks (rubric v1).
 */
export function splitClaimsByKeyword(findings: ReadonlyArray<JudgedFinding | undefined>) {
  const kinds: Record<ClaimKind, KindTally> = {
    seen: { ok: 0, wrong: 0, unclear: 0 },
    not_seen: { ok: 0, wrong: 0, unclear: 0 },
    frame: { ok: 0, wrong: 0, unclear: 0 },
  };
  let claims = 0;
  let findingsWithWrongSeenClaim = 0;
  let findingsWrongOnlyByNotSeenOrFrame = 0;
  for (const finding of findings) {
    const wrongKinds = new Set<ClaimKind>();
    for (const claim of finding?.claims ?? []) {
      const kind = claimKind(claim.text);
      claims += 1;
      if (claim.mark === 'ok') kinds[kind].ok += 1;
      else if (claim.mark === 'unclear') kinds[kind].unclear += 1;
      else {
        kinds[kind].wrong += 1;
        wrongKinds.add(kind);
      }
    }
    if (wrongKinds.has('seen')) findingsWithWrongSeenClaim += 1;
    else if (wrongKinds.size > 0) findingsWrongOnlyByNotSeenOrFrame += 1;
  }
  if (claims === 0) return null;
  return {
    seen: withError(kinds.seen),
    not_seen: withError(kinds.not_seen),
    frame: withError(kinds.frame),
    findingsWithWrongSeenClaim,
    findingsWrongOnlyByNotSeenOrFrame,
  };
}

/**
 * Shares pooled over several runs of the same findings. The interval of the difference uses the
 * number of distinct findings, not of verdicts: two verdicts on one finding are not independent.
 */
export function poolFindings(runs: ReadonlyArray<readonly FindingItem[]>) {
  const counts = { detective: emptyCounts(), single: emptyCounts() };
  for (const run of runs) for (const item of run) addVerdict(counts[item.group], item.finding);
  const arm = (group: JudgeArm) => ({
    ...withRates(counts[group]),
    claimsByKeywordHeuristic: splitClaimsByKeyword(
      runs.flatMap((run) => run.filter((item) => item.group === group).map((i) => i.finding)),
    ),
  });
  const detective = arm('detective');
  const single = arm('single');
  const n = Math.max(1, runs.length);
  const detectiveMinusSingle = newcombeDiff(
    detective.unsupported / n,
    detective.judged / n,
    single.unsupported / n,
    single.judged / n,
  );
  return { runs: runs.length, detective, single, detectiveMinusSingle };
}

/** The summary the judge wrote next to its verdicts; null when the folder has none. */
function storedSummary(dir: string, file: string): Record<string, unknown> | null {
  const full = path.join(dir, file);
  return existsSync(full) ? (readJson(full) as Record<string, unknown>) : null;
}

/** Model, seed and rubric of a findings run. Runs of spikes 1 and 2 stored no rubric: v1. */
function findingsMeta(dir: string) {
  const s = storedSummary(dir, 'judge-summary.json');
  return {
    run: label(dir),
    judgeModel: s?.['judgeModel'] ?? null,
    seed: s?.['seed'] ?? null,
    rubric: s?.['rubric'] ?? 'v1',
  };
}

function findingsReport(runDirs: readonly string[], refDir: string | null) {
  const runs = runDirs.map((dir) => ({ dir, items: loadFindingRun(dir) }));
  const ref = refDir === null ? null : { dir: refDir, items: loadFindingRun(refDir) };
  const betweenRuns = runs.flatMap((a, i) =>
    runs.slice(i + 1).map((b) => ({
      first: label(a.dir),
      second: label(b.dir),
      ...agreementByGroup(a.items, b.items, 'unsupported'),
    })),
  );
  return {
    pooled: poolFindings(runs.map((run) => run.items)),
    // Spike 3, bar 5; null for runs without the claim kinds of rubric v3.
    seenClaimBar: seenClaimBar(runs.map((run) => run.items)),
    perRun: runs.map((run) => ({ ...findingsMeta(run.dir), ...poolFindings([run.items]) })),
    betweenRuns,
    reference: ref === null ? null : { ...findingsMeta(ref.dir), ...poolFindings([ref.items]) },
    againstRef:
      ref === null
        ? []
        : runs.map((run) => ({
            run: label(run.dir),
            ...agreementByGroup(ref.items, run.items, 'unsupported'),
          })),
  };
}

function eyesReport(runDirs: readonly string[], refDir: string | null) {
  const summaryOf = (dir: string) => ({
    run: label(dir),
    summary: storedSummary(dir, 'eyes-judge-summary.json'),
  });
  const ref = refDir === null ? null : loadEyesRun(refDir);
  return {
    runs: runDirs.map(summaryOf),
    reference: refDir === null ? null : summaryOf(refDir),
    againstRef:
      ref === null
        ? []
        : runDirs.map((dir) => ({
            run: label(dir),
            ...agreementByGroup(ref, loadEyesRun(dir), 'wrong'),
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
