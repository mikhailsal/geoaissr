import { expect, test } from 'bun:test';
import { FIRST_ASK, SECOND_ASK, makeSession } from './test-helpers.ts';
import type { DetectiveSession } from './session.ts';

async function answerCurrent(
  session: DetectiveSession,
  answers: Array<{ n: number; value: string; frame?: number }>,
) {
  await session.call('eyes', 'next_request', {});
  const req = session.state.broker.current();
  if (!req) throw new Error('no request');
  return session.call('eyes', 'answer', { request_id: req.id, answers });
}

test('an ask is answered by the eyes with frame numbers and reaches the brain as text', async () => {
  const session = makeSession();
  await session.call('eyes', 'observe', {});
  const asked = session.call('brain', 'ask', FIRST_ASK);
  const ack = await answerCurrent(session, [
    { n: 1, value: 'left', frame: 2 },
    { n: 2, value: 'LAWSON', frame: 2 },
  ]);
  expect(ack.isError).toBeUndefined();
  const reply = await asked;
  expect(reply.text).toContain('Левостороннее');
  expect(reply.text).toContain('"LAWSON" (кадр 2)');
  expect(reply.images).toBeUndefined();
  expect(session.state.asks[0]?.outcome?.settledBy).toBe('answer');
});

test('an answer citing a frame that was never issued is refused and can be corrected', async () => {
  const session = makeSession();
  await session.call('eyes', 'observe', {});
  const asked = session.call('brain', 'ask', FIRST_ASK);
  const bad = await answerCurrent(session, [
    { n: 1, value: 'left', frame: 9 },
    { n: 2, value: 'unreadable' },
  ]);
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain('кадра 9 не было');
  const wrongValue = await answerCurrent(session, [{ n: 1, value: 'leftish', frame: 1 }]);
  expect(wrongValue.text).toContain('не из списка');
  await answerCurrent(session, [
    { n: 1, value: 'left', frame: 1 },
    { n: 2, value: 'unreadable' },
  ]);
  const items = (await asked).text;
  expect(items).toContain('неразборчиво');
  expect(session.state.eyesAnswers.map((a) => a.result)).toEqual(['invalid', 'invalid', 'settled']);
});

test('a transcription target naming a place is refused before it reaches the eyes', async () => {
  const session = makeSession();
  const reply = await session.call('brain', 'ask', {
    hypothesis: 'h',
    questions: [{ kind: 'text', target: 'японская вывеска' }],
  });
  expect(reply.isError).toBe(true);
  expect(reply.text).toContain('GEO_DETECTIVE_PLACE_WORD');
  expect(session.state.asks).toHaveLength(0);
  expect(session.state.broker.hasPending()).toBe(false);
});

test('from the second ask on, finding and current_guess are required once per ask', async () => {
  const session = makeSession({ answerSource: 'labels' });
  await session.call('brain', 'ask', FIRST_ASK);
  const bare = await session.call('brain', 'ask', {
    hypothesis: 'h',
    questions: FIRST_ASK.questions,
  });
  expect(bare.text).toContain('GEO_BOT_JOURNAL_FIELD_MISSING');
  expect(bare.text).toContain('finding, current_guess');
  const again = await session.call('brain', 'ask', {
    hypothesis: 'h',
    questions: FIRST_ASK.questions,
  });
  expect(again.isError).toBeUndefined();
  expect(session.state.asks[1]?.findingState).toBe('missing');
  const full = await session.call('brain', 'ask', SECOND_ASK);
  expect(full.isError).toBeUndefined();
  expect(session.state.asks[2]?.findingState).toBe('recorded');
  expect(session.state.checkpoints).toHaveLength(1);
});

test('the labels arm answers from the manifest labels and sign text', async () => {
  const session = makeSession({ answerSource: 'labels' });
  const reply = await session.call('brain', 'ask', FIRST_ASK);
  expect(reply.text).toContain('Левостороннее');
  expect(reply.text).toContain('ローソン LAWSON');
});

test('an ask times out when the eyes stay silent, and the late answer is dropped', async () => {
  const session = makeSession({ askTimeoutMs: 30 });
  const reply = await session.call('brain', 'ask', FIRST_ASK);
  expect(reply.text).toContain('глаза не ответили вовремя');
  const late = await session.call('eyes', 'answer', {
    request_id: session.state.asks[0]?.outcome?.requestId,
    answers: [{ n: 1, value: 'left', frame: 1 }],
  });
  expect(late.text).toContain('ответ отброшен');
});

test('the eyes exiting fails the pending ask fast and tells the brain to guess', async () => {
  const session = makeSession();
  const asked = session.call('brain', 'ask', FIRST_ASK);
  session.eyesExited();
  const reply = await asked;
  expect(reply.isError).toBe(true);
  expect(reply.text).toContain('Немедленно вызови final_guess');
});

test('no ask is sent when less than the reserve remains', async () => {
  let now = 0;
  const session = makeSession({ now: () => now });
  now = 81_000;
  const reply = await session.call('brain', 'ask', FIRST_ASK);
  expect(reply.text).toContain('Осталось меньше 10 с');
});

test('roles cannot call each other tools, and look stops at the move limit for free', async () => {
  const session = makeSession();
  expect((await session.call('brain', 'look', { heading: 0 })).isError).toBe(true);
  expect((await session.call('eyes', 'ask', FIRST_ASK)).isError).toBe(true);
  await session.call('eyes', 'observe', {});
  await session.call('eyes', 'look', { heading: 30, fov: 30 });
  const second = await session.call('eyes', 'look', { heading: 60 });
  expect(second.text).toContain('Кадр 6');
  const third = await session.call('eyes', 'look', { heading: 90 });
  expect(third.isError).toBe(true);
  expect(session.state.turnsUsed).toBe(2);
  expect(session.state.frames.map((f) => f.heading)).toEqual([10, 100, 190, 280, 30, 60]);
});

test('final_guess asks once for missing fields, then closes the round for both roles', async () => {
  const session = makeSession();
  let fired = 0;
  session.onFinal(() => {
    fired += 1;
  });
  const first = await session.call('brain', 'final_guess', { lat: 35, lng: 139 });
  expect(first.text).toContain('summary, finding');
  expect(session.state.checkpoints).toHaveLength(1);
  const second = await session.call('brain', 'final_guess', { lat: 36, lng: 140 });
  expect(second.isError).toBeUndefined();
  expect(fired).toBe(1);
  expect((await session.call('eyes', 'next_request', {})).text).toContain('Раунд окончен');
  expect((await session.call('brain', 'ask', FIRST_ASK)).isError).toBe(true);
});
