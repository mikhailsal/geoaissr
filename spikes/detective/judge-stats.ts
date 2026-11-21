import type { JudgeArm, SpotBatch } from './judge-extract.ts';

/** Verdict aggregation and the Newcombe interval for the unsupported-finding bar. */

export type Verdict = 'supported' | 'unsupported' | 'no_visual_claim';

export interface JudgedFinding {
  n: number;
  verdict: Verdict;
  rule_ok: boolean | null;
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

interface ArmCounts {
  supported: number;
  unsupported: number;
  noVisualClaim: number;
  ruleOk: number;
  ruleWrong: number;
  missingVerdicts: number;
}

function emptyCounts(): ArmCounts {
  return {
    supported: 0,
    unsupported: 0,
    noVisualClaim: 0,
    ruleOk: 0,
    ruleWrong: 0,
    missingVerdicts: 0,
  };
}

function addVerdict(c: ArmCounts, v: JudgedFinding | undefined): void {
  if (!v) {
    c.missingVerdicts += 1;
    return;
  }
  if (v.verdict === 'supported') c.supported += 1;
  else if (v.verdict === 'unsupported') c.unsupported += 1;
  else c.noVisualClaim += 1;
  if (v.rule_ok === true) c.ruleOk += 1;
  if (v.rule_ok === false) c.ruleWrong += 1;
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
  const rateOf = (c: ArmCounts) => {
    const judged = c.supported + c.unsupported;
    return { ...c, judged, unsupportedRate: judged === 0 ? null : r3(c.unsupported / judged) };
  };
  const single = rateOf(counts.single);
  const detective = rateOf(counts.detective);
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
