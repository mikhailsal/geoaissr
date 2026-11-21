import { seededRandom, type JudgeArm } from './judge-extract.ts';
import { isWrongMark, type JudgedFinding } from './judge-stats.ts';

/**
 * Bar 5 of spike 3 (docs/evals/detective-spike-3.md, Part C amendment): the error of the `seen`
 * claims of Detective's findings against the single agent's, under rubric v3 and pooled over the
 * judge runs. The interval resamples spots, because the claims of one spot are not independent.
 */

export interface SeenItem {
  /** Starts with the spot id and a «|», as `loadFindingRun` builds it. */
  id: string;
  group: JudgeArm;
  finding: JudgedFinding | undefined;
}

interface Tally {
  ok: number;
  wrong: number;
}

type SpotTally = Record<JudgeArm, Tally>;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function tallyBySpot(runs: ReadonlyArray<readonly SeenItem[]>): Map<string, SpotTally> {
  const spots = new Map<string, SpotTally>();
  for (const run of runs) {
    for (const item of run) {
      const spotId = item.id.split('|')[0] ?? '';
      const spot = spots.get(spotId) ?? {
        detective: { ok: 0, wrong: 0 },
        single: { ok: 0, wrong: 0 },
      };
      spots.set(spotId, spot);
      for (const claim of item.finding?.claims ?? []) {
        if (claim.kind !== 'seen') continue;
        if (claim.mark === 'ok') spot[item.group].ok += 1;
        else if (isWrongMark(claim.mark)) spot[item.group].wrong += 1;
      }
    }
  }
  return spots;
}

function errorOf(spots: readonly SpotTally[], arm: JudgeArm): number | null {
  const ok = spots.reduce((n, s) => n + s[arm].ok, 0);
  const wrong = spots.reduce((n, s) => n + s[arm].wrong, 0);
  return ok + wrong === 0 ? null : wrong / (ok + wrong);
}

function diffOf(spots: readonly SpotTally[]): number | null {
  const detective = errorOf(spots, 'detective');
  const single = errorOf(spots, 'single');
  return detective === null || single === null ? null : detective - single;
}

/** Percentile interval of the difference over resampled spots; null when it cannot be formed. */
function bootstrap(spots: readonly SpotTally[], resamples: number, seed: number) {
  const rand = seededRandom(seed);
  const diffs: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const sample = spots.map(() => spots[Math.floor(rand() * spots.length)] as SpotTally);
    const d = diffOf(sample);
    if (d !== null) diffs.push(d);
  }
  if (diffs.length < resamples / 2) return null;
  diffs.sort((a, b) => a - b);
  const at = (q: number): number => diffs[Math.floor(q * (diffs.length - 1))] ?? 0;
  return { low: r3(at(0.025)), high: r3(at(0.975)) };
}

export const BAR5_MAX_DIFFERENCE = 0.05;
/** The bootstrap seed that the amendment of Part C fixes (item 10). */
export const BAR5_BOOTSTRAP_SEED = 20261129;

/** Null when the runs hold no `seen` claim, that is under rubrics v1 and v2. */
export function seenClaimBar(
  runs: ReadonlyArray<readonly SeenItem[]>,
  opts: { resamples?: number; seed?: number } = {},
) {
  const spots = [...tallyBySpot(runs).values()];
  const detective = errorOf(spots, 'detective');
  const single = errorOf(spots, 'single');
  const diff = diffOf(spots);
  if (detective === null || single === null || diff === null) return null;
  return {
    spots: spots.length,
    detectiveSeenError: r3(detective),
    singleSeenError: r3(single),
    detectiveMinusSingle: r3(diff),
    ci: bootstrap(spots, opts.resamples ?? 2000, opts.seed ?? BAR5_BOOTSTRAP_SEED),
    maxDifference: BAR5_MAX_DIFFERENCE,
    barPassed: diff <= BAR5_MAX_DIFFERENCE,
  };
}
