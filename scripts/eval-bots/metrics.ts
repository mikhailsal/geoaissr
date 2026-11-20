import type { RoundRecord } from './records.ts';

export const MOVEMENT_THRESHOLD_KM = 25;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Linear-interpolation quantile (q in 0..1); null for an empty list. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const lo = sorted[base] ?? 0;
  const hi = sorted[base + 1] ?? lo;
  return lo + (pos - base) * (hi - lo);
}

export function computeMedianAndIqr(values: readonly number[]): {
  median: number | null;
  iqr: number | null;
} {
  const q1 = quantile(values, 0.25);
  const q2 = quantile(values, 0.5);
  const q3 = quantile(values, 0.75);
  if (q1 === null || q2 === null || q3 === null) return { median: null, iqr: null };
  return { median: round1(q2), iqr: round1(q3 - q1) };
}

function share(count: number, total: number): number | null {
  return total === 0 ? null : round3(count / total);
}

function rounded(v: number | null): number | null {
  return v === null ? null : round1(v);
}

function numbers(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

export interface RunConfig {
  label: string | null;
  harness: string;
  model: string;
  budgetSec: number;
  moveLimit: number;
  imageSize: number;
  concurrency: number;
  repeats: number;
  spots: number;
  dry: boolean;
  gitCommit: string;
  date: string;
}

export interface EvalSummary extends RunConfig {
  rounds: number;
  /** Share of rounds where the bot submitted a final guess before finishing. */
  finishRate: number | null;
  /** Share of rounds with no pin at all (neither final nor checkpoint). */
  noPinRate: number | null;
  timeToFinalP50Sec: number | null;
  timeToFinalP95Sec: number | null;
  medianErrorKm: number | null;
  iqrErrorKm: number | null;
  medianPinMovementKm: number | null;
  shareMovementOver25Km: number | null;
  medianPaidLooks: number | null;
  /** Paid steps with a finding over all paid steps; null when the bot contract has no findings. */
  shareStepsWithFinding: number | null;
}

export function summarizeRounds(config: RunConfig, records: readonly RoundRecord[]): EvalSummary {
  const total = records.length;
  const times = numbers(records.map((r) => r.timeToFinalSec));
  const { median, iqr } = computeMedianAndIqr(numbers(records.map((r) => r.errorKm)));
  const moves = numbers(records.map((r) => r.pinMovementKm));
  const withFinding = records.filter((r) => r.stepsWithFinding !== null);
  const paid = withFinding.reduce((acc, r) => acc + r.paidLooks, 0);
  const found = withFinding.reduce((acc, r) => acc + (r.stepsWithFinding ?? 0), 0);
  return {
    ...config,
    rounds: total,
    finishRate: share(records.filter((r) => r.hasFinalGuess).length, total),
    noPinRate: share(records.filter((r) => r.pinSource === 'none').length, total),
    timeToFinalP50Sec: rounded(quantile(times, 0.5)),
    timeToFinalP95Sec: rounded(quantile(times, 0.95)),
    medianErrorKm: median,
    iqrErrorKm: iqr,
    medianPinMovementKm: rounded(quantile(moves, 0.5)),
    shareMovementOver25Km: share(
      moves.filter((m) => m > MOVEMENT_THRESHOLD_KM).length,
      moves.length,
    ),
    medianPaidLooks: rounded(
      quantile(
        records.map((r) => r.paidLooks),
        0.5,
      ),
    ),
    shareStepsWithFinding: paid === 0 || withFinding.length === 0 ? null : share(found, paid),
  };
}
