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

const finding = (tMs: number, turn: number, text: string | null): TimedEvent => ({
  tMs,
  event: {
    type: 'bot_finding',
    ...IDS,
    turn,
    findingState: text ? 'recorded' : 'missing',
    ...(text ? { finding: text } : {}),
  },
});

// protects=Stage 1 findings counted per paid step from bot_finding events; fails_when=findings read from thumbs (never set) or the observe step counted; no_claim=finding quality.
test('buildRoundRecord counts paid steps whose journal finding was recorded', () => {
  const rec = buildRoundRecord(CTX, [
    finding(1, 0, 'start frames'),
    thumb(2, 1),
    finding(3, 1, null),
    thumb(4, 2),
    finding(5, 2, 'left-hand traffic'),
    guess(6, 0, true),
    finished(7),
  ]);
  expect(rec.stepsWithFinding).toBe(1);
  expect(rec.steps.map((s) => s.finding)).toEqual([null, 'left-hand traffic']);
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

const crashed: TimedEvent = {
  tMs: 9,
  event: {
    type: 'bot_finished',
    ...IDS,
    aborted: true,
    reason: 'ошибка процесса (код 1)',
    diagnosticsTail: 'Invalid API key',
  },
};

test('an abort after tool calls or a timeout is a measured outcome, not an infra error', () => {
  const played = { ...CTX, audit: { toolCalls: 3, corrections: 0 } };
  expect(buildRoundRecord(played, [crashed]).infraError).toBeNull();
  expect(buildRoundRecord({ ...CTX, timedOut: true }, [thumb(1, 1)]).infraError).toBeNull();
});

// Value: protects=a CLI that dies before its first tool call (credentials, a bad flag) is an infra error, not a measured no-finish; fails_when=such rounds count in the finish rate; why_new=only a spawn failure was classified as infra; seam=none; no_claim=which stderr text a CLI prints.
test('a process error before any tool call is an infra error', () => {
  expect(buildRoundRecord(CTX, [crashed]).infraError).toBe('Invalid API key');
});

// Value: protects=the finish rate and pin are measured inside the budget; fails_when=a final accepted during the post-budget grace counts as a finish; why_new=the grace window was scored like the budget; seam=none; no_claim=when the runner stops the CLI.
test('guesses after the budget are not scored', () => {
  const rec = buildRoundRecord(CTX, [
    guess(30_000, 1, false),
    guess(61_000, 2, true),
    finished(62_000),
  ]);
  expect(rec).toMatchObject({
    hasFinalGuess: false,
    pinSource: 'checkpoint',
    pin: { lat: 1, lng: 0 },
  });
  expect(rec.timeToFinalSec).toBeNull();
});

// Value: protects=pin movement is measured only from a real checkpoint; fails_when=a final-only round reports its final as the first checkpoint and 0 km movement; why_new=movement had no final-only case; seam=none; no_claim=how movement is aggregated.
test('a final-only round has no first checkpoint and no movement', () => {
  const rec = buildRoundRecord(CTX, [guess(4000, 2, true), finished(5000)]);
  expect(rec.firstCheckpoint).toBeNull();
  expect(rec.pinMovementKm).toBeNull();
  expect(rec.hasFinalGuess).toBe(true);
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
