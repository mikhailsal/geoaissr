import { expect, test } from 'bun:test';
import {
  buildRoundRecord,
  pickScoredGuess,
  type RoundContext,
  type TimedEvent,
} from './records.ts';

const IDS = { matchId: 'm', gen: 1, roundNumber: 1, botId: 'b' } as const;
const CTX: RoundContext = {
  spotId: 's1',
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
