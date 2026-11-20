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

/** Wilson score interval (95%) for a proportion; null for a zero denominator. */
export function wilsonInterval(
  successes: number,
  total: number,
): { low: number; high: number } | null {
  if (total <= 0) return null;
  const z = 1.959964;
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return { low: round3(Math.max(0, centre - half)), high: round3(Math.min(1, centre + half)) };
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
  /** Reasoning effort of the bot slot. */
  effort: string;
  /** First 12 hex of the sha256 of the system prompt text sent to the bots. */
  promptHash: string;
  /** First 12 hex of the sha256 of the tool list JSON sent to the bots. */
  toolSchemaHash: string;
  /** First 12 hex of the sha256 of the manifest file; null for the built-in dry spots. */
  datasetHash: string | null;
  /** spots x repeats the run intended to execute. */
  plannedRounds: number;
  /** The run was cut short by Ctrl-C. */
  interrupted: boolean;
}

export interface EvalSummary extends RunConfig {
  /** Rounds that ran (measured plus infra errors); same as completedRounds. */
  rounds: number;
  completedRounds: number;
  /** Rounds that could not run (harness launch or setup failure); excluded from every rate. */
  infraErrorRounds: number;
  /** Rounds that produced a measured outcome (completedRounds minus infraErrorRounds). */
  measuredRounds: number;
  /** True when every planned round ran and the run was not interrupted. */
  complete: boolean;
  /** Tool calls rejected with an isError correction; null when the audit saw no tool calls. */
  correctionCount: number | null;
  /** correctionCount over audited tool calls; null when there were none. */
  correctionRate: number | null;
  /** Share of measured rounds where the bot submitted a final guess before finishing. */
  finishRate: number | null;
  /** Wilson 95% interval of finishRate. */
  finishRateCi95: { low: number; high: number } | null;
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

function summarizeCorrections(records: readonly RoundRecord[]): {
  count: number | null;
  rate: number | null;
} {
  const audited = records.filter((r) => r.toolCalls !== null && r.corrections !== null);
  const calls = audited.reduce((acc, r) => acc + (r.toolCalls ?? 0), 0);
  if (audited.length === 0) return { count: null, rate: null };
  const count = audited.reduce((acc, r) => acc + (r.corrections ?? 0), 0);
  return { count, rate: share(count, calls) };
}

export function summarizeRounds(config: RunConfig, all: readonly RoundRecord[]): EvalSummary {
  const records = all.filter((r) => r.infraError === null);
  const total = records.length;
  const finals = records.filter((r) => r.hasFinalGuess).length;
  const corrections = summarizeCorrections(records);
  const times = numbers(records.map((r) => r.timeToFinalSec));
  const { median, iqr } = computeMedianAndIqr(numbers(records.map((r) => r.errorKm)));
  const moves = numbers(records.map((r) => r.pinMovementKm));
  const withFinding = records.filter((r) => r.stepsWithFinding !== null);
  const paid = withFinding.reduce((acc, r) => acc + r.paidLooks, 0);
  const found = withFinding.reduce((acc, r) => acc + (r.stepsWithFinding ?? 0), 0);
  return {
    ...config,
    rounds: all.length,
    completedRounds: all.length,
    infraErrorRounds: all.length - total,
    measuredRounds: total,
    complete: !config.interrupted && all.length === config.plannedRounds,
    correctionCount: corrections.count,
    correctionRate: corrections.rate,
    finishRate: share(finals, total),
    finishRateCi95: wilsonInterval(finals, total),
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
