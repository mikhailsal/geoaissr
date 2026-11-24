import { expect, test } from 'bun:test';
import { ASK, FINAL, answerCurrent, briefed, makeSession } from './test-helpers.ts';

test('final_guess owes a control check once, then a confidence level and the deciding clue', async () => {
  const { session, log } = await briefed();
  const bare = { lat: 35, lng: 139, summary: 'Я прочитал отчёт.', finding: 'Вывеска решила.' };
  // No control ask yet and time for one: the first final_guess is refused once with a reminder.
  const early = await session.call('brain', 'final_guess', bare);
  expect(early.isError).toBe(true);
  expect(early.text).toContain('GEO_DETECTIVE_CONTROL_MISSING');
  expect(session.state.final).toBe(false);
  const missing = await session.call('brain', 'final_guess', bare);
  expect(missing.isError).toBe(true);
  expect(missing.text).toContain('GEO_BOT_JOURNAL_FIELD_MISSING');
  expect(missing.text).toContain('confidence');
  expect(missing.text).toContain('clue');
  expect(session.state.final).toBe(false);
  const full = await session.call('brain', 'final_guess', {
    ...bare,
    confidence: 'region',
    clue: 'Вывеска латиницей.',
    quip: 'Спасибо глазам.',
  });
  expect(full.isError).toBeUndefined();
  expect(session.state.final).toBe(true);
  expect(log.corrections.map((c) => c.reason)).toEqual([
    'control',
    'confidence (country | region | guess),clue',
  ]);
  expect(log.corrections.map((c) => c.code)).toEqual([
    'GEO_DETECTIVE_CONTROL_MISSING',
    'GEO_BOT_JOURNAL_FIELD_MISSING',
  ]);
  expect(log.corrections[1]?.missing).toEqual(['confidence', 'clue']);
  // Both refused guesses left their point as a checkpoint; the third is the final answer.
  expect(log.guesses.map((g) => g.finalized)).toEqual([false, false, true]);
  expect(log.guesses[2]?.guess).toEqual({
    lat: 35,
    lng: 139,
    explanation: 'Я прочитал отчёт.',
    summary: 'Я прочитал отчёт.',
    quip: 'Спасибо глазам.',
    confidence: 'region',
    clue: 'Вывеска латиницей.',
  });
  // The finding of the final guess describes the last step (the report: no ask was made).
  expect(log.findings).toEqual([{ turn: 0, findingState: 'recorded', finding: 'Вывеска решила.' }]);
});

test('a final_guess after a control ask, or with little time left, gets no reminder', async () => {
  const checked = await briefed();
  const asked = checked.session.call('brain', 'ask', { ...ASK, control: true });
  await answerCurrent(checked.session, [
    { n: 1, value: 'жёлтые номера', confidence: 'sure', frame: 2 },
    { n: 2, value: 'not_visible' },
  ]);
  await asked;
  expect((await checked.session.call('brain', 'final_guess', FINAL)).isError).toBeUndefined();
  expect(checked.log.findings.at(-1)?.turn).toBe(1);
  // 25 s left: a control ask no longer fits.
  const late = await briefed();
  late.setRemainingMs(25_000);
  expect((await late.session.call('brain', 'final_guess', FINAL)).isError).toBeUndefined();
  expect(late.log.corrections).toHaveLength(0);
});

test('a final guess ends the round for both roles', async () => {
  const { session } = await briefed();
  const idle = session.call('eyes', 'next_request', {});
  // The first call gets the control reminder; the second is accepted.
  await session.call('brain', 'final_guess', FINAL);
  await session.call('brain', 'final_guess', FINAL);
  expect(session.state.final).toBe(true);
  // The waiting eyes wake at once and are told to stop.
  expect((await idle).text).toContain('Раунд окончен');
  expect((await session.call('eyes', 'look', { heading: 10 })).text).toContain('Раунд окончен');
  expect((await session.call('brain', 'ask', ASK)).isError).toBe(true);
  expect(session.submittedGuess()).toBe(true);
});

test('an ask the eyes never answer times out, and the brain is told so', async () => {
  const { session, log } = await briefed({ askTimeoutMs: 40 });
  const reply = await session.call('brain', 'ask', ASK);
  expect(reply.isError).toBeUndefined();
  expect(reply.text).toContain('напарник не ответил вовремя');
  const settled = log.steps.filter((s) => s.turn === 1).at(-1);
  expect(settled?.patch.requests?.map((r) => r.status)).toEqual(['timeout', 'timeout']);
  // The late answer is dropped, not written over the settled exchange.
  const late = await session.call('eyes', 'answer', {
    request_id: 'unknown',
    answers: [{ n: 1, value: 'not_visible' }],
  });
  expect(late.isError).toBe(true);
});

test('when the eyes exit, the outstanding ask settles as eyes_down and the brain must guess', async () => {
  const { session, log } = await briefed();
  const asked = session.call('brain', 'ask', ASK);
  await session.call('eyes', 'next_request', {});
  session.eyesExited();
  const reply = await asked;
  expect(reply.isError).toBe(true);
  expect(reply.text).toContain('процесс напарника завершился');
  expect(reply.text).toContain('final_guess');
  const settled = log.steps.filter((s) => s.turn === 1).at(-1);
  expect(settled?.patch.requests?.map((r) => r.status)).toEqual(['eyes_down', 'eyes_down']);
  // No control reminder once the eyes are gone: the guess is accepted at once.
  expect((await session.call('brain', 'final_guess', FINAL)).isError).toBeUndefined();
});

test('with under ten seconds left an ask is refused; ending the session stops everything', async () => {
  const t = await briefed();
  t.setRemainingMs(9000);
  const refused = await t.session.call('brain', 'ask', ASK);
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain('Осталось меньше 10 с');
  expect(t.session.state.asks).toBe(0);
  const other = makeSession({ briefingWaitMs: 5000 });
  const waiting = other.session.call('brain', 'briefing', {});
  other.session.end();
  expect((await waiting).text).toContain('Раунд окончен');
  expect((await other.session.call('eyes', 'observe', {})).text).toContain('Раунд окончен');
  expect(other.log.frames).toHaveLength(0);
});
