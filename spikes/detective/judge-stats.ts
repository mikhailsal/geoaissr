import type { JudgeArm, SpotBatch } from './judge-extract.ts';

/** Verdict aggregation and the Newcombe interval for the unsupported-finding bar. */

export type Verdict = 'supported' | 'unsupported' | 'no_visual_claim' | 'unclear';

/** Rubric v2 (docs/evals/detective-spike-3.md, Part A): the judge marks each visual claim. */
export type ClaimMark = 'ok' | 'contradicted' | 'absent' | 'unclear';

/**
 * Rubric v3 (docs/evals/detective-spike-3.md, Part C amendment): `seen` states that something is
 * visible or what it looks like; `not_seen` states that something is absent or cannot be read.
 */
export type SeenKind = 'seen' | 'not_seen';

export interface JudgedClaim {
  text: string;
  mark: ClaimMark;
  /** Present only under rubric v3. */
  kind?: SeenKind;
}

export interface JudgedFinding {
  n: number;
  verdict: Verdict;
  rule_ok: boolean | null;
  /** Present only under rubric v2. */
  claims?: JudgedClaim[];
}

export const isWrongMark = (mark: ClaimMark): boolean =>
  mark === 'contradicted' || mark === 'absent';

/**
 * Rubrics v2 and v3: the script, not the judge, turns the claim marks into the verdict of a
 * finding. Under v3 only a wrong `seen` claim makes a finding unsupported: a wrong `not_seen`
 * claim is a miss of the eyes, counted apart.
 */
export function verdictFromClaims(claims: readonly JudgedClaim[]): Verdict {
  if (claims.length === 0) return 'no_visual_claim';
  if (claims.some((c) => isWrongMark(c.mark) && c.kind !== 'not_seen')) return 'unsupported';
  return claims.some((c) => c.mark === 'ok') ? 'supported' : 'unclear';
}

const Z = 1.959964;

function wilson(hits: number, total: number): { low: number; high: number } {
  const p = hits / total;
  const z2 = Z * Z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Newcombe hybrid score interval (method 10) for p1 - p2 with independent samples. */
export function newcombeDiff(
  hits1: number,
  n1: number,
  hits2: number,
  n2: number,
): { diff: number; low: number; high: number } | null {
  if (n1 === 0 || n2 === 0) return null;
  const p1 = hits1 / n1;
  const p2 = hits2 / n2;
  const w1 = wilson(hits1, n1);
  const w2 = wilson(hits2, n2);
  const diff = p1 - p2;
  const low = diff - Math.sqrt((p1 - w1.low) ** 2 + (w2.high - p2) ** 2);
  const high = diff + Math.sqrt((w1.high - p1) ** 2 + (p2 - w2.low) ** 2);
  return { diff: r3(diff), low: r3(low), high: r3(high) };
}

export interface ArmCounts {
  supported: number;
  unsupported: number;
  /** Rubric v2 only: every visual claim of the finding was marked `unclear`. */
  unclear: number;
  noVisualClaim: number;
  ruleOk: number;
  ruleWrong: number;
  missingVerdicts: number;
  /** Rubric v2 only: marks over all visual claims of the arm. */
  claims: Record<ClaimMark, number>;
  /** Rubric v3 only: the same marks, split by the judge's claim kind. */
  seenClaims: Record<ClaimMark, number>;
  notSeenClaims: Record<ClaimMark, number>;
  /**
   * Rubric v3 only: the verdicts as rubric v2 derives them, where a wrong claim of either kind
   * fails a finding. They keep the shares comparable with Part A.
   */
  v2Supported: number;
  v2Unsupported: number;
}

const noMarks = (): Record<ClaimMark, number> => ({
  ok: 0,
  contradicted: 0,
  absent: 0,
  unclear: 0,
});

export function emptyCounts(): ArmCounts {
  return {
    supported: 0,
    unsupported: 0,
    unclear: 0,
    noVisualClaim: 0,
    ruleOk: 0,
    ruleWrong: 0,
    missingVerdicts: 0,
    claims: noMarks(),
    seenClaims: noMarks(),
    notSeenClaims: noMarks(),
    v2Supported: 0,
    v2Unsupported: 0,
  };
}

function addV2Reading(c: ArmCounts, claims: readonly JudgedClaim[]): void {
  if (!claims.some((claim) => claim.kind !== undefined)) return;
  const verdict = verdictFromClaims(claims.map(({ text, mark }) => ({ text, mark })));
  if (verdict === 'supported') c.v2Supported += 1;
  if (verdict === 'unsupported') c.v2Unsupported += 1;
}

export function addVerdict(c: ArmCounts, v: JudgedFinding | undefined): void {
  if (!v) {
    c.missingVerdicts += 1;
    return;
  }
  if (v.verdict === 'supported') c.supported += 1;
  else if (v.verdict === 'unsupported') c.unsupported += 1;
  else if (v.verdict === 'unclear') c.unclear += 1;
  else c.noVisualClaim += 1;
  if (v.rule_ok === true) c.ruleOk += 1;
  if (v.rule_ok === false) c.ruleWrong += 1;
  for (const claim of v.claims ?? []) {
    c.claims[claim.mark] += 1;
    if (claim.kind === 'seen') c.seenClaims[claim.mark] += 1;
    if (claim.kind === 'not_seen') c.notSeenClaims[claim.mark] += 1;
  }
  addV2Reading(c, v.claims ?? []);
}

/** Wrong marks over the settled ones (`unclear` left out); null when nothing was settled. */
export function markErrorRate(marks: Record<ClaimMark, number>): number | null {
  const wrong = marks.contradicted + marks.absent;
  const settled = wrong + marks.ok;
  return settled === 0 ? null : r3(wrong / settled);
}

/** Shares of an arm: unsupported findings over judged ones, wrong claims over settled ones. */
export function withRates(c: ArmCounts) {
  const judged = c.supported + c.unsupported;
  const v2Judged = c.v2Supported + c.v2Unsupported;
  return {
    ...c,
    judged,
    unsupportedRate: judged === 0 ? null : r3(c.unsupported / judged),
    v2UnsupportedRate: v2Judged === 0 ? null : r3(c.v2Unsupported / v2Judged),
    claimErrorRate: markErrorRate(c.claims),
    seenClaimErrorRate: markErrorRate(c.seenClaims),
    notSeenClaimErrorRate: markErrorRate(c.notSeenClaims),
  };
}

export function summarizeJudgement(
  batches: readonly SpotBatch[],
  verdicts: ReadonlyMap<string, readonly JudgedFinding[]>,
) {
  const counts: Record<JudgeArm, ArmCounts> = { detective: emptyCounts(), single: emptyCounts() };
  for (const batch of batches) {
    const byN = new Map((verdicts.get(batch.spotId) ?? []).map((v) => [v.n, v]));
    for (const [n, item] of batch.key) addVerdict(counts[item.arm], byN.get(n));
  }
  const single = withRates(counts.single);
  const detective = withRates(counts.detective);
  // Positive difference: the single agent has more unsupported findings than Detective.
  const difference = newcombeDiff(
    single.unsupported,
    single.judged,
    detective.unsupported,
    detective.judged,
  );
  return { single, detective, difference, ...readDifference(difference) };
}

/** The pre-registered reading: an interval that includes 0 is "no difference". */
function readDifference(d: ReturnType<typeof newcombeDiff>): {
  reading: string;
  barPassed: boolean;
} {
  if (d === null) return { reading: 'no data', barPassed: false };
  if (d.high < 0) return { reading: 'detective higher', barPassed: false };
  if (d.low <= 0) return { reading: 'no difference', barPassed: false };
  if (d.diff < 0.1) return { reading: 'detective lower by less than 10 points', barPassed: false };
  return { reading: 'detective at least 10 points lower', barPassed: true };
}
