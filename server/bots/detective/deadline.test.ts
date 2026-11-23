import { expect, test } from 'bun:test';
import { ASK, FINAL, briefed, makeSession, manualGate, until } from './test-helpers.ts';

// Value: protects=when every human confirms and the round gets shorter, a waiting brain is released in time to send its final guess; fails_when=the brain stays inside ask until the old deadline and the round ends on a checkpoint; why_new=the wait was sized once, from the deadline known at the call; seam=none; no_claim=the engine's choice of the new deadline.
test('a round that gets shorter cuts the outstanding ask and leaves time for the final guess', async () => {
  const t = await briefed({ askTimeoutMs: 60_000 });
  const started = Date.now();
  const asked = t.session.call('brain', 'ask', ASK);
  await t.session.call('eyes', 'next_request', {});
  // 90 s were left when the ask was sent; now the round ends in 10.03 s.
  t.setRemainingMs(10_030);
  t.session.deadlineMoved();
  const reply = await asked;
  expect(Date.now() - started).toBeLessThan(5000);
  expect(reply.text).toContain('напарник не ответил вовремя');
  expect(reply.text).toContain('Немедленно вызови final_guess');
  expect(t.session.state.broker.hasPending()).toBe(false);
  const final = await t.session.call('brain', 'final_guess', FINAL);
  expect(final.isError).toBeUndefined();
  expect(t.log.guesses.at(-1)?.finalized).toBe(true);
  // After the round nothing is left to cut.
  t.session.deadlineMoved();
});

test('a round that gets shorter wakes a brain that waits for the report', async () => {
  const t = makeSession({ briefingWaitMs: 60_000 });
  const started = Date.now();
  const briefing = t.session.call('brain', 'briefing', {});
  await until(() => t.session.state.reportWaiters.length > 0);
  t.setRemainingMs(15_000);
  t.session.deadlineMoved();
  const reply = await briefing;
  expect(Date.now() - started).toBeLessThan(5000);
  expect(reply.isError).toBe(true);
  expect(reply.text).toContain('Немедленно вызови final_guess');
});

// Value: protects=no Detective guess is final before the round has started; fails_when=a brain that calls final_guess during loading freezes its answer before the eyes see a frame; why_new=only briefing waited for the start; seam=none; no_claim=what a model does while it waits.
test('final_guess waits for the round start like the camera bot does', async () => {
  const start = manualGate();
  const t = makeSession({ waitStart: start.wait });
  const final = t.session.call('brain', 'final_guess', FINAL);
  // A turn of the event loop: a handler that did not wait would have recorded the guess by now.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(t.log.guesses).toHaveLength(0);
  expect(t.session.submittedGuess()).toBe(false);
  start.open();
  expect((await final).isError).toBeUndefined();
  expect(t.log.guesses.map((g) => g.finalized)).toEqual([true]);
});
