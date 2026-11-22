import { quantile, wilsonInterval } from '../../scripts/eval-bots/metrics.ts';
import type { EffortLevel } from '../../shared/bot-tools.ts';
import { getRegionDiagonalKm } from '../../shared/regions.ts';
import { calculateRoundScore } from '../../shared/score.ts';
import { CONFIDENCE_LEVELS, type Confidence } from './ceiling-prompts.ts';

/** Numbers and rules of the ceiling test (docs/evals/detective-spike-3.md, Part B). */

export interface CeilingRow {
  spotId: string;
  repeat: number;
  describer: string;
  brainModel: string;
  effort: EffortLevel;
  pin: { lat: number; lng: number };
  confidence: Confidence;
  clue: string;
  errorKm: number;
  /** Always null: a call that fails twice leaves no row. Kept for the paired comparison. */
  infraError: null;
  /** Place words masked in the report before the brain read it. */
  maskedWords: string[];
  usage: unknown;
}

const r1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function rate(hits: number, total: number) {
  return {
    hits,
    total,
    rate: total === 0 ? null : r3(hits / total),
    ci: wilsonInterval(hits, total),
  };
}

function errorStats(rows: readonly CeilingRow[]) {
  const errors = rows.map((r) => r.errorKm);
  const within = (km: number): number => errors.filter((e) => e <= km).length;
  return {
    rounds: rows.length,
    medianErrorKm: r1(quantile(errors, 0.5)),
    within25: rate(within(25), rows.length),
    within750: rate(within(750), rows.length),
    beyond2000: rate(errors.filter((e) => e > 2000).length, rows.length),
  };
}

export function summarizeCeiling(rows: readonly CeilingRow[]) {
  const diagonal = getRegionDiagonalKm('world');
  const scores = rows.map((r) => calculateRoundScore(r.errorKm, diagonal));
  return {
    ...errorStats(rows),
    spots: new Set(rows.map((r) => r.spotId)).size,
    meanScore:
      scores.length === 0 ? null : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    byConfidence: Object.fromEntries(
      CONFIDENCE_LEVELS.map((level) => [
        level,
        errorStats(rows.filter((r) => r.confidence === level)),
      ]),
    ),
  };
}

export interface Share {
  hits: number;
  total: number;
}

const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
/** Ten points and sixty percent are compared on counts, so allow for rounding. */
const EPS = 1e-9;

const share = (s: Share): number => (s.total === 0 ? 0 : s.hits / s.total);

/**
 * The rules fixed in Part B, from the shares of rounds within 750 km. `low` is the low-effort
 * brain on the better describer's reports; null until it has run.
 */
export function ceilingDecision(medium: { haiku: Share; sonnet: Share }, low: Share | null) {
  const sonnetBetter = share(medium.sonnet) > share(medium.haiku) + EPS;
  const best = sonnetBetter ? medium.sonnet : medium.haiku;
  const effortGap = low === null ? null : share(best) - share(low);
  return {
    betterDescriber: sonnetBetter ? SONNET : HAIKU,
    betterShare: r3(share(best)),
    stop: share(best) < 0.6 - EPS,
    eyesModel: share(medium.sonnet) - share(medium.haiku) >= 0.1 - EPS ? SONNET : HAIKU,
    brainEffort: effortGap === null ? null : effortGap >= 0.1 - EPS ? 'medium' : 'low',
  };
}
