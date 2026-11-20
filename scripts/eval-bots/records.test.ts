import { expect, test } from 'bun:test';
import {
  buildFailedRecord,
  buildRoundRecord,
  LAUNCH_FAILURE_REASON,
  pickScoredGuess,
  type RoundContext,
  type TimedEvent,
} from './records.ts';

const IDS = { matchId: 'm', gen: 1, roundNumber: 1, botId: 'b' } as const;
const CTX: RoundContext = {
  spotId: 's1',
  executionId: 'abc1234567',
  repeat: 1,
  harness: 'claude',
  model: 'm',
  budgetSec: 60,
  moveLimit: 4,
  truth: { lat: 0, lng: 0 },
  timedOut: false,
};

const guess = (tMs: number, lat: number, finalized?: boolean): TimedEvent => ({
  tMs,
  event: {
    type: 'bot_guess_recorded',
    ...IDS,
    guess: { lat, lng: 0, explanation: 'e' },
    finalized,
  },
});
const thumb = (tMs: number, turn: number, extra: object = {}): TimedEvent => ({
  tMs,
  event: {
    type: 'bot_thumb_added',
    ...IDS,
    thumb: { turn, action: 'look', label: 'l', thumbUrl: 'u', hypothesis: `h${turn}`, ...extra },
  },
});
const finished = (tMs: number): TimedEvent => ({
  tMs,
  event: { type: 'bot_finished', ...IDS, aborted: false, reason: 'done' },
});

test('pickScoredGuess prefers the first final, then the last checkpoint, then none', () => {
  expect(
    pickScoredGuess([guess(1, 1, false), guess(2, 2), guess(3, 3), finished(4)]),
  ).toMatchObject({
    source: 'final',
    tMs: 2,
  });
  expect(pickScoredGuess([guess(1, 1, false), guess(2, 2, false), finished(3)])).toMatchObject({
    source: 'checkpoint',
    tMs: 2,
  });
  expect(pickScoredGuess([finished(1), guess(2, 2)])).toMatchObject({ source: 'none' });
});

test('buildRoundRecord derives timing, movement and look counts from events', () => {
  const rec = buildRoundRecord(CTX, [
    thumb(500, 1),
    guess(1000, 1, false),
    thumb(2000, 2),
    guess(5500, 2, true),
    finished(6000),
  ]);
  expect(rec.finished).toBe(true);
  expect(rec.hasFinalGuess).toBe(true);
  expect(rec.timeToFinalSec).toBe(5.5);
  expect(rec.pinSource).toBe('final');
  expect(rec.firstCheckpoint).toEqual({ lat: 1, lng: 0, tSec: 1 });
  expect(rec.pinMovementKm).toBeCloseTo(111.2, 0);
  expect(rec.errorKm).toBeCloseTo(222.4, 0);
  expect(rec.paidLooks).toBe(2);
  expect(rec.stepsWithFinding).toBeNull();
  expect(rec.steps.map((s) => s.hypothesis)).toEqual(['h1', 'h2']);
});

test('buildRoundRecord counts findings only when the thumb carries the field', () => {
  const rec = buildRoundRecord(CTX, [
    thumb(1, 1, { finding: 'left-hand traffic' }),
    thumb(2, 2, { finding: '' }),
    guess(3, 0, true),
    finished(4),
  ]);
  expect(rec.stepsWithFinding).toBe(1);
});

test('buildRoundRecord marks a round without guesses as no pin', () => {
  const rec = buildRoundRecord({ ...CTX, timedOut: true }, [thumb(1, 1)]);
  expect(rec).toMatchObject({
    finished: false,
    timedOut: true,
    pinSource: 'none',
    errorKm: null,
    pinMovementKm: null,
    hasFinalGuess: false,
  });
});

test('time to final is when the final guess was accepted, not when the process exited', () => {
  const rec = buildRoundRecord(CTX, [guess(4200, 0, true), finished(58_000)]);
  expect(rec.timeToFinalSec).toBe(4.2);
});

test('a harness launch failure is an infra error, not a measured timeout', () => {
  const launchFailure: TimedEvent = {
    tMs: 5,
    event: {
      type: 'bot_finished',
      ...IDS,
      aborted: true,
      reason: LAUNCH_FAILURE_REASON,
      diagnosticsTail: 'spawn claude ENOENT',
    },
  };
  const rec = buildRoundRecord(CTX, [launchFailure]);
  expect(rec.infraError).toBe('spawn claude ENOENT');
  expect(rec.timedOut).toBe(false);
  expect(rec.hasFinalGuess).toBe(false);
});

test('an ordinary abort or a timeout is a measured outcome, not an infra error', () => {
  const crashed: TimedEvent = {
    tMs: 9,
    event: { type: 'bot_finished', ...IDS, aborted: true, reason: 'ошибка процесса (код 1)' },
  };
  expect(buildRoundRecord(CTX, [crashed]).infraError).toBeNull();
  expect(buildRoundRecord({ ...CTX, timedOut: true }, [thumb(1, 1)]).infraError).toBeNull();
});

test('the dispatch audit is recorded, or null when not observable', () => {
  expect(buildRoundRecord(CTX, [finished(1)])).toMatchObject({
    toolCalls: null,
    corrections: null,
  });
  const rec = buildRoundRecord({ ...CTX, audit: { toolCalls: 7, corrections: 2 } }, [finished(1)]);
  expect(rec).toMatchObject({ toolCalls: 7, corrections: 2 });
});

test('a setup failure becomes an infra error record', () => {
  const { truth: _truth, timedOut: _timedOut, ...base } = CTX;
  expect(buildFailedRecord(base, new Error('no frames')).infraError).toBe('no frames');
});
