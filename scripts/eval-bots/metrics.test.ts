import { expect, test } from 'bun:test';
import {
  computeMedianAndIqr,
  quantile,
  summarizeRounds,
  wilsonInterval,
  type RunConfig,
} from './metrics.ts';
import type { RoundRecord } from './records.ts';

const CONFIG: RunConfig = {
  label: 'x',
  harness: 'claude',
  model: 'm',
  budgetSec: 60,
  moveLimit: 4,
  imageSize: 640,
  concurrency: 1,
  repeats: 1,
  spots: 1,
  spotIds: ['s1'],
  dry: true,
  gitCommit: 'abc',
  date: '2026-01-01T00:00:00.000Z',
  effort: 'low',
  promptHash: 'p',
  toolSchemaHash: 't',
  datasetHash: null,
  plannedRounds: 1,
  interrupted: false,
};

function record(over: Partial<RoundRecord>): RoundRecord {
  return {
    spotId: 's',
    executionId: 'x',
    repeat: 1,
    harness: 'claude',
    model: 'm',
    budgetSec: 60,
    moveLimit: 4,
    finished: true,
    aborted: false,
    finishReason: 'done',
    timedOut: false,
    hasFinalGuess: true,
    timeToFinalSec: 30,
    pin: { lat: 0, lng: 0 },
    pinSource: 'final',
    errorKm: 100,
    firstCheckpoint: null,
    pinMovementKm: null,
    paidLooks: 2,
    stepsWithFinding: null,
    tokenUsage: null,
    steps: [],
    toolCalls: null,
    corrections: null,
    infraError: null,
    error: null,
    ...over,
  };
}

test('quantile interpolates and handles empty input', () => {
  expect(quantile([], 0.5)).toBeNull();
  expect(quantile([5], 0.95)).toBe(5);
  expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  expect(quantile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 5);
});

test('computeMedianAndIqr matches hand-computed values', () => {
  expect(computeMedianAndIqr([])).toEqual({ median: null, iqr: null });
  expect(computeMedianAndIqr([1, 2, 3, 4, 5])).toEqual({ median: 3, iqr: 2 });
});

test('summarizeRounds computes rates, percentiles and movement shares', () => {
  const summary = summarizeRounds(CONFIG, [
    record({ errorKm: 10, timeToFinalSec: 20, pinMovementKm: 0, paidLooks: 2 }),
    record({ errorKm: 30, timeToFinalSec: 40, pinMovementKm: 50, paidLooks: 4 }),
    record({
      hasFinalGuess: false,
      pinSource: 'checkpoint',
      timeToFinalSec: null,
      errorKm: 500,
      pinMovementKm: 25,
      paidLooks: 4,
    }),
    record({
      hasFinalGuess: false,
      finished: false,
      pinSource: 'none',
      pin: null,
      timeToFinalSec: null,
      errorKm: null,
      paidLooks: 0,
    }),
  ]);
  expect(summary.rounds).toBe(4);
  expect(summary.finishRate).toBe(0.5);
  expect(summary.noPinRate).toBe(0.25);
  expect(summary.timeToFinalP50Sec).toBe(30);
  expect(summary.timeToFinalP95Sec).toBe(39);
  expect(summary.medianErrorKm).toBe(30);
  expect(summary.medianPinMovementKm).toBe(25);
  // 25 km exactly is not over the threshold; only the 50 km move counts.
  expect(summary.shareMovementOver25Km).toBe(0.333);
  expect(summary.medianPaidLooks).toBe(3);
  expect(summary.shareStepsWithFinding).toBeNull();
});

test('summarizeRounds reports the finding share only over rounds that carry findings', () => {
  const summary = summarizeRounds(CONFIG, [
    record({ paidLooks: 4, stepsWithFinding: 3 }),
    record({ paidLooks: 4, stepsWithFinding: 1 }),
    record({ paidLooks: 9, stepsWithFinding: null }),
  ]);
  expect(summary.shareStepsWithFinding).toBe(0.5);
});

test('summarizeRounds handles an empty run', () => {
  const summary = summarizeRounds(CONFIG, []);
  expect(summary.rounds).toBe(0);
  expect(summary.finishRate).toBeNull();
  expect(summary.medianErrorKm).toBeNull();
});

test('wilsonInterval matches known values and is null for a zero denominator', () => {
  expect(wilsonInterval(0, 0)).toBeNull();
  expect(wilsonInterval(5, 10)).toEqual({ low: 0.237, high: 0.763 });
  expect(wilsonInterval(10, 10)).toEqual({ low: 0.722, high: 1 });
  expect(wilsonInterval(0, 10)).toEqual({ low: 0, high: 0.278 });
});

test('finish rate carries a Wilson interval', () => {
  const summary = summarizeRounds({ ...CONFIG, plannedRounds: 2 }, [
    record({}),
    record({ hasFinalGuess: false, pinSource: 'none', pin: null, errorKm: null }),
  ]);
  expect(summary.finishRate).toBe(0.5);
  expect(summary.finishRateCi95).toEqual({ low: 0.095, high: 0.905 });
});

test('every metric with a zero denominator is null, never NaN or 0', () => {
  const summary = summarizeRounds({ ...CONFIG, plannedRounds: 0 }, []);
  const nullable = [
    'finishRate',
    'finishRateCi95',
    'noPinRate',
    'timeToFinalP50Sec',
    'timeToFinalP95Sec',
    'medianErrorKm',
    'iqrErrorKm',
    'medianPinMovementKm',
    'shareMovementOver25Km',
    'medianPaidLooks',
    'shareStepsWithFinding',
    'correctionCount',
    'correctionRate',
  ] as const;
  for (const key of nullable) expect(summary[key]).toBeNull();
  expect(JSON.stringify(summary)).not.toContain('NaN');
});

test('infra-error rounds are counted but excluded from every rate', () => {
  const summary = summarizeRounds({ ...CONFIG, plannedRounds: 3 }, [
    record({}),
    record({ infraError: 'spawn claude ENOENT', hasFinalGuess: false, pinSource: 'none' }),
  ]);
  expect(summary).toMatchObject({
    plannedRounds: 3,
    completedRounds: 2,
    infraErrorRounds: 1,
    measuredRounds: 1,
    complete: false,
    finishRate: 1,
    noPinRate: 0,
  });
});

test('complete is true only for a full, uninterrupted run; partial summaries say so', () => {
  const rounds = [record({}), record({})];
  expect(summarizeRounds({ ...CONFIG, plannedRounds: 2 }, rounds).complete).toBe(true);
  const partial = summarizeRounds({ ...CONFIG, plannedRounds: 5, interrupted: true }, rounds);
  expect(partial).toMatchObject({ complete: false, plannedRounds: 5, completedRounds: 2 });
  expect(summarizeRounds({ ...CONFIG, plannedRounds: 2, interrupted: true }, rounds).complete).toBe(
    false,
  );
});

test('corrections are summed over audited rounds and are null when not observable', () => {
  expect(summarizeRounds(CONFIG, [record({})])).toMatchObject({
    correctionCount: null,
    correctionRate: null,
  });
  const summary = summarizeRounds({ ...CONFIG, plannedRounds: 2 }, [
    record({ toolCalls: 6, corrections: 1 }),
    record({ toolCalls: 4, corrections: 1 }),
    record({ toolCalls: null, corrections: null }),
  ]);
  expect(summary).toMatchObject({ correctionCount: 2, correctionRate: 0.2 });
});
