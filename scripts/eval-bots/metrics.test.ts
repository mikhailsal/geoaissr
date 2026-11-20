import { expect, test } from 'bun:test';
import { computeMedianAndIqr, quantile, summarizeRounds, type RunConfig } from './metrics.ts';
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
  dry: true,
  gitCommit: 'abc',
  date: '2026-01-01T00:00:00.000Z',
};

function record(over: Partial<RoundRecord>): RoundRecord {
  return {
    spotId: 's',
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
