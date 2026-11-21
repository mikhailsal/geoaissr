import { computeMedianAndIqr, quantile, wilsonInterval } from '../../scripts/eval-bots/metrics.ts';
import { getRegionDiagonalKm } from '../../shared/regions.ts';
import { calculateRoundScore } from '../../shared/score.ts';
import { NONE_OF_THESE } from './choice.ts';
import type { Protocol } from './protocol.ts';
import type { DetectiveRoundRecord } from './records.ts';
import type { ScoredItem } from './scoring.ts';

/** Aggregate numbers of one Detective arm. Committed as JSON; per-round files stay local. */

export interface DetectiveRunConfig {
  label: string | null;
  arm: DetectiveRoundRecord['arm'];
  /** The brain's model. */
  model: string;
  eyesModel: string;
  protocol: Protocol;
  requireZoom: boolean;
  effort: string;
  budgetSec: number;
  moveLimit: number;
  imageSize: number;
  concurrency: number;
  repeats: number;
  spots: number;
  spotIds: string[];
  plannedRounds: number;
  dry: boolean;
  gitCommit: string;
  date: string;
  promptHash: string;
  toolSchemaHash: string;
  datasetHash: string | null;
  interrupted: boolean;
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

function nums(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

function itemsOf(records: readonly DetectiveRoundRecord[], kind: ScoredItem['kind']): ScoredItem[] {
  return records.flatMap((r) => r.asks.flatMap((a) => a.items.filter((i) => i.kind === kind)));
}

function itemCounts(items: readonly ScoredItem[]) {
  const answered = items.filter((i) => i.agrees !== null);
  return {
    asked: items.length,
    answered: answered.length,
    abstained: items.filter((i) => i.status === 'abstained').length,
    timeout: items.filter((i) => i.status === 'timeout').length,
    eyesDown: items.filter((i) => i.status === 'eyes_down').length,
    agreement: rate(answered.filter((i) => i.agrees === true).length, answered.length),
  };
}

function perFeature(
  items: readonly ScoredItem[],
): Record<string, { answered: number; agree: number }> {
  const out: Record<string, { answered: number; agree: number }> = {};
  for (const item of items) {
    if (item.feature === null || item.agrees === null) continue;
    const row = (out[item.feature] ??= { answered: 0, agree: 0 });
    row.answered += 1;
    if (item.agrees) row.agree += 1;
  }
  return out;
}

function choiceCounts(items: readonly ScoredItem[]) {
  return {
    asked: items.length,
    answered: items.filter((i) => i.status === 'answered').length,
    noneOfThese: items.filter((i) => i.value === NONE_OF_THESE).length,
    abstained: items.filter((i) => i.status === 'abstained').length,
    timeout: items.filter((i) => i.status === 'timeout').length,
    eyesDown: items.filter((i) => i.status === 'eyes_down').length,
  };
}

/** Error bands and the game score on the world map (spike 2's accuracy bar). */
function accuracy(records: readonly DetectiveRoundRecord[]) {
  const diagonal = getRegionDiagonalKm('world');
  // A round without a pin scores 0 points and counts as outside every band.
  const scores = records.map((r) =>
    r.errorKm === null ? 0 : calculateRoundScore(r.errorKm, diagonal),
  );
  const within = (km: number) =>
    rate(records.filter((r) => r.errorKm !== null && r.errorKm <= km).length, records.length);
  return {
    within25Km: within(25),
    within750Km: within(750),
    scoreMedian: quantile(scores, 0.5),
  };
}

function tokenMedians(records: readonly DetectiveRoundRecord[]) {
  const brain = nums(records.map((r) => r.brain?.usage?.totalTokens ?? null));
  const eyes = nums(records.map((r) => r.eyes?.usage?.totalTokens ?? null));
  const both = nums(
    records.map((r) =>
      r.brain?.usage ? r.brain.usage.totalTokens + (r.eyes?.usage?.totalTokens ?? 0) : null,
    ),
  );
  return {
    brainMedian: r1(quantile(brain, 0.5)),
    eyesMedian: r1(quantile(eyes, 0.5)),
    perRoundMedian: r1(quantile(both, 0.5)),
    roundsWithUsage: both.length,
  };
}

function askStats(records: readonly DetectiveRoundRecord[]) {
  const asks = records.flatMap((r) => r.asks);
  const answeredCycles = nums(asks.filter((a) => a.settledBy === 'answer').map((a) => a.cycleSec));
  const due = asks.filter((a) => a.findingState !== 'not_due');
  return {
    exchangesMedian: quantile(
      records.map((r) => r.exchanges),
      0.5,
    ),
    exchangesAtLeast3: rate(records.filter((r) => r.exchanges >= 3).length, records.length),
    askCycleSec: {
      p50: r1(quantile(answeredCycles, 0.5)),
      p95: r1(quantile(answeredCycles, 0.95)),
      n: answeredCycles.length,
    },
    settledBy: {
      answer: asks.filter((a) => a.settledBy === 'answer').length,
      timeout: asks.filter((a) => a.settledBy === 'timeout').length,
      eyesDown: asks.filter((a) => a.settledBy === 'eyes_down').length,
      closed: asks.filter((a) => a.settledBy === 'closed').length,
    },
    findingsRecorded: rate(due.filter((a) => a.findingState === 'recorded').length, due.length),
  };
}

export function summarizeDetective(
  config: DetectiveRunConfig,
  all: readonly DetectiveRoundRecord[],
) {
  const records = all.filter((r) => r.infraError === null);
  const features = itemsOf(records, 'feature');
  const texts = itemsOf(records, 'text');
  const choices = itemsOf(records, 'choice');
  const inventedPlaces = texts.flatMap((t) => t.inventedPlaces);
  return {
    ...config,
    completedRounds: all.length,
    infraErrorRounds: all.length - records.length,
    complete: !config.interrupted && all.length === config.plannedRounds,
    measuredRounds: records.length,
    finishRate: rate(records.filter((r) => r.hasFinalGuess).length, records.length),
    noPinRate: rate(records.filter((r) => r.pin === null).length, records.length),
    timeToFinalSec: {
      p50: r1(quantile(nums(records.map((r) => r.timeToFinalSec)), 0.5)),
      p95: r1(quantile(nums(records.map((r) => r.timeToFinalSec)), 0.95)),
    },
    errorKm: computeMedianAndIqr(nums(records.map((r) => r.errorKm))),
    accuracy: accuracy(records),
    ...askStats(records),
    questionMix: { feature: features.length, choice: choices.length, text: texts.length },
    features: { ...itemCounts(features), perFeature: perFeature(features) },
    choices: choiceCounts(choices),
    transcriptions: {
      ...itemCounts(texts),
      inventedPlaceNames: inventedPlaces.length,
      inventedPlaces,
    },
    tokens: tokenMedians(records),
    corrections: records.reduce((n, r) => n + r.corrections.length, 0),
    guardRejections: records.reduce((n, r) => n + r.guardRejections.length, 0),
    lateAnswers: records.reduce((n, r) => n + r.lateAnswers, 0),
    invalidAnswers: records.reduce((n, r) => n + r.invalidAnswers, 0),
    zoomRefusals: records.reduce((n, r) => n + r.zoomRefusals, 0),
    eyesLooksMedian: quantile(
      records.map((r) => r.eyesLooks),
      0.5,
    ),
  };
}

export type DetectiveSummary = ReturnType<typeof summarizeDetective>;
