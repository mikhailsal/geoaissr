import { expect, test } from 'bun:test';
import { ASK, FINAL, REPORT, answerCurrent, briefed, makeSession } from './test-helpers.ts';

test('briefing waits for the report and returns it with place words masked', async () => {
  const { session, log } = makeSession({ briefingWaitMs: 2000 });
  // After the first frames the eyes are sent to the text hunt, not to next_request.
  const seen = await session.call('eyes', 'observe', {});
  expect(seen.text).toContain('охота за текстом');
  expect(seen.images).toHaveLength(4);
  const waiting = session.call('brain', 'briefing', {});
  const filed = await session.call('eyes', 'report', REPORT);
  expect(filed.isError).toBeUndefined();
  const reply = await waiting;
  expect(reply.isError).toBeUndefined();
  expect(reply.text).toContain('«LAWSON» — вывеска на […] магазине (кадр 1)');
  expect(reply.text).toContain('Дорога:\n- Сторона движения: левая');
  expect(reply.text).toContain('Природа:\n- ничего не отмечено');
  expect(reply.text).toContain('Платных ходов у напарника: 4.');
  // The brain never receives an image.
  expect(reply.images).toBeUndefined();
  // The journal gets the four start frames and the report as the brain read it.
  expect(log.frames.map((f) => [f.turn, f.n, f.action])).toEqual([
    [0, 1, 'observe'],
    [0, 2, 'observe'],
    [0, 3, 'observe'],
    [0, 4, 'observe'],
  ]);
  expect(log.steps).toEqual([
    {
      turn: 0,
      patch: {
        report: [
          { section: 'texts', text: '«LAWSON» — вывеска на […] магазине', frame: 1 },
          { section: 'road', text: 'Сторона движения: левая — машины стоят слева', frame: 2 },
        ],
      },
    },
  ]);
});

test('a briefing with no report yet asks the brain to call again', async () => {
  const { session } = makeSession({ briefingWaitMs: 30 });
  const reply = await session.call('brain', 'briefing', {});
  expect(reply.isError).toBeUndefined();
  expect(reply.text).toContain('Отчёт ещё не готов');
  expect(session.state.briefed).toBe(false);
});

test('a briefing after the eyes left tells the brain to guess at once', async () => {
  const { session } = makeSession({ briefingWaitMs: 2000 });
  const waiting = session.call('brain', 'briefing', {});
  session.eyesExited();
  const reply = await waiting;
  expect(reply.isError).toBe(true);
  expect(reply.text).toContain('final_guess');
});

test('the eyes must file the report before the first request, and only once', async () => {
  const { session } = makeSession();
  const early = await session.call('eyes', 'report', REPORT);
  expect(early.text).toContain('Сначала вызови observe');
  await session.call('eyes', 'observe', {});
  const noReport = await session.call('eyes', 'next_request', {});
  expect(noReport.isError).toBe(true);
  expect(noReport.text).toContain('вызови report');
  const empty = await session.call('eyes', 'report', { sections: {} });
  expect(empty.text).toContain('Отчёт пуст');
  const unknown = await session.call('eyes', 'report', { sections: { guess: [] } });
  expect(unknown.isError).toBe(true);
  await session.call('eyes', 'report', {
    sections: { road: [{ text: 'грунтовая дорога', frame: 9 }] },
  });
  const again = await session.call('eyes', 'report', REPORT);
  expect(again.text).toContain('Отчёт уже принят');
  expect(session.state.report).toEqual([{ section: 'road', text: 'грунтовая дорога', frame: 9 }]);
});

test('each role reaches only its own tools', async () => {
  const { session } = makeSession();
  expect((await session.call('brain', 'observe', {})).text).toContain('недоступен мозгу');
  expect((await session.call('brain', 'look', { heading: 0 })).isError).toBe(true);
  expect((await session.call('eyes', 'ask', ASK)).text).toContain('недоступен глазам');
  expect((await session.call('eyes', 'final_guess', FINAL)).isError).toBe(true);
  expect(session.state.frames).toHaveLength(0);
  expect(session.submittedGuess()).toBe(false);
});

test('an ask needs the briefing first, then finding and current_guess', async () => {
  const { session, log } = makeSession();
  await session.call('eyes', 'observe', {});
  await session.call('eyes', 'report', REPORT);
  const early = await session.call('brain', 'ask', ASK);
  expect(early.text).toContain('Сначала вызови briefing');
  await session.call('brain', 'briefing', {});
  const bare = { hypothesis: ASK.hypothesis, requests: ASK.requests };
  const refused = await session.call('brain', 'ask', bare);
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain('GEO_BOT_JOURNAL_FIELD_MISSING');
  expect(refused.text).toContain('из отчёта');
  expect(session.state.asks).toBe(0);
  // Logged with the same fields as the camera bot's journal correction.
  expect(log.corrections).toEqual([
    {
      role: 'brain',
      tool: 'ask',
      reason: 'finding,current_guess',
      missing: ['finding', 'current_guess'],
      code: 'GEO_BOT_JOURNAL_FIELD_MISSING',
    },
  ]);
  // One correction per step: the same call again is accepted and the step is marked as missing.
  const asked = session.call('brain', 'ask', bare);
  await answerCurrent(session, [
    { n: 1, value: 'not_visible' },
    { n: 2, value: 'not_visible' },
  ]);
  expect((await asked).isError).toBeUndefined();
  expect(log.findings).toEqual([{ turn: 0, findingState: 'missing', pointMissing: true }]);
});

test('a request that asks a question or names a place is refused and not counted', async () => {
  const { session, log } = await briefed();
  const withMark = await session.call('brain', 'ask', {
    ...ASK,
    requests: [{ kind: 'describe', topic: 'какого цвета номера машин?' }],
  });
  expect(withMark.text).toContain('GEO_DETECTIVE_QUESTION_FORM');
  const withLi = await session.call('brain', 'ask', {
    ...ASK,
    requests: [{ kind: 'describe', topic: 'есть ли пальмы вдоль дороги' }],
  });
  expect(withLi.text).toContain('GEO_DETECTIVE_QUESTION_FORM');
  const place = await session.call('brain', 'ask', {
    ...ASK,
    requests: [{ kind: 'text', target: 'японская вывеска' }],
  });
  expect(place.text).toContain('GEO_DETECTIVE_PLACE_WORD');
  expect(session.state.asks).toBe(0);
  expect(session.state.broker.hasPending()).toBe(false);
  expect(log.steps.filter((s) => s.turn > 0)).toEqual([]);
});

test('the eyes answer in their own words with a confidence; the brain reads it masked', async () => {
  const { session, log } = await briefed();
  const asked = session.call('brain', 'ask', { ...ASK, control: true });
  const noConfidence = await answerCurrent(session, [
    { n: 1, value: 'жёлтые узкие номера', frame: 2 },
    { n: 2, value: 'not_visible' },
  ]);
  expect(noConfidence.isError).toBe(true);
  expect(noConfidence.text).toContain('укажи confidence');
  const badFrame = await answerCurrent(session, [
    { n: 1, value: 'жёлтые узкие номера', confidence: 'sure', frame: 9 },
    { n: 2, value: 'no_road' },
  ]);
  expect(badFrame.text).toContain('кадра 9 не было');
  expect(badFrame.text).toContain('no_road годится только для проезда');
  const ack = await answerCurrent(session, [
    { n: 1, value: 'жёлтые узкие номера, как на тайских такси', confidence: 'unsure', frame: 2 },
    { n: 2, value: 'unreadable' },
  ]);
  expect(ack.isError).toBeUndefined();
  const reply = await asked;
  expect(reply.text).toContain('жёлтые узкие номера, как на […] такси (неуверенно, кадр 2)');
  expect(reply.text).toContain('неразборчиво');
  // The journal step of the first exchange: opened as pending, then settled with masked text.
  const patches = log.steps.filter((s) => s.turn === 1).map((s) => s.patch);
  expect(patches[0]?.reason).toBe(ASK.hypothesis);
  expect(patches[0]?.control).toBe(true);
  expect(patches[0]?.requests?.map((r) => r.status)).toEqual(['pending', 'pending']);
  expect(patches[1]?.requests).toEqual([
    {
      n: 1,
      kind: 'describe',
      text: 'номера машин: форма и цвета',
      status: 'answered',
      value: 'жёлтые узкие номера, как на […] такси',
      confidence: 'unsure',
      frame: 2,
    },
    {
      n: 2,
      kind: 'text',
      text: 'синяя табличка на доме, кадр 2',
      status: 'abstained',
      value: 'unreadable',
    },
  ]);
  // The finding of the first ask describes the report step, and its point is a checkpoint.
  expect(log.findings[0]).toEqual({
    turn: 0,
    findingState: 'recorded',
    finding: ASK.finding,
    currentGuess: { lat: 35, lng: 139 },
  });
  expect(log.guesses).toEqual([
    { guess: { lat: 35, lng: 139, explanation: '' }, finalized: false },
  ]);
});
