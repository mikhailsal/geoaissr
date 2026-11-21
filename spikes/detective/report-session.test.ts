import { expect, test } from 'bun:test';
import type { DetectiveSession } from './session.ts';
import { makeSession } from './test-helpers.ts';

/** The report protocol of spike 3 (docs/evals/detective-spike-3.md, Part C). */

const REPORT = {
  sections: {
    texts: [{ text: '«LAWSON» — вывеска на японском магазине', frame: 1 }],
    road: [{ text: 'серый асфальт, машины стоят слева', frame: 2 }],
  },
};

const ASK = {
  hypothesis: 'Вывеска и сторона движения разделят версии.',
  requests: [
    { kind: 'describe', topic: 'номера машин: форма и цвета' },
    { kind: 'text', target: 'синяя табличка на доме, кадр 2' },
  ],
  finding: 'В отчёте есть вывеска латиницей и левосторонняя парковка.',
  current_guess: { lat: 35, lng: 139 },
};

function reportSession(overrides: Parameters<typeof makeSession>[0] = {}): DetectiveSession {
  return makeSession({ protocol: 'report', briefingWaitMs: 300, ...overrides });
}

async function briefed(overrides: Parameters<typeof makeSession>[0] = {}) {
  const session = reportSession(overrides);
  await session.call('eyes', 'observe', {});
  await session.call('eyes', 'report', REPORT);
  await session.call('brain', 'briefing', {});
  return session;
}

async function answerCurrent(session: DetectiveSession, answers: unknown[]) {
  await session.call('eyes', 'next_request', {});
  const req = session.state.broker.current();
  if (!req) throw new Error('no request');
  return session.call('eyes', 'answer', { request_id: req.id, answers });
}

test('briefing waits for the report and returns it with place words masked', async () => {
  const session = reportSession({ briefingWaitMs: 2000 });
  await session.call('eyes', 'observe', {});
  const waiting = session.call('brain', 'briefing', {});
  const filed = await session.call('eyes', 'report', REPORT);
  expect(filed.isError).toBeUndefined();
  const reply = await waiting;
  expect(reply.isError).toBeUndefined();
  expect(reply.text).toContain('«LAWSON» — вывеска на […] магазине (кадр 1)');
  expect(reply.text).toContain('Дорога:');
  expect(reply.images).toBeUndefined();
  expect(session.state.report?.maskedWords).toEqual(['японском']);
  expect(session.state.report?.raw.sections.texts[0]?.text).toContain('японском');
  expect(session.state.briefingAtMs).not.toBeNull();
});

test('a briefing with no report yet asks the brain to call again', async () => {
  const session = reportSession({ briefingWaitMs: 30 });
  const reply = await session.call('brain', 'briefing', {});
  expect(reply.isError).toBeUndefined();
  expect(reply.text).toContain('Отчёт ещё не готов');
  expect(session.state.briefingAtMs).toBeNull();
});

test('a briefing after the eyes left tells the brain to guess at once', async () => {
  const session = reportSession({ briefingWaitMs: 2000 });
  const waiting = session.call('brain', 'briefing', {});
  session.eyesExited();
  const reply = await waiting;
  expect(reply.isError).toBe(true);
  expect(reply.text).toContain('final_guess');
});

test('the eyes must file the report before the first request, and only once', async () => {
  const session = reportSession();
  const early = await session.call('eyes', 'report', REPORT);
  expect(early.text).toContain('Сначала вызови observe');
  await session.call('eyes', 'observe', {});
  const noReport = await session.call('eyes', 'next_request', {});
  expect(noReport.isError).toBe(true);
  expect(noReport.text).toContain('вызови report');
  const empty = await session.call('eyes', 'report', { sections: {} });
  expect(empty.text).toContain('Отчёт пуст');
  await session.call('eyes', 'report', {
    sections: { road: [{ text: 'грунтовая дорога', frame: 9 }] },
  });
  expect(session.state.report?.unknownFrames).toBe(1);
  const again = await session.call('eyes', 'report', REPORT);
  expect(again.text).toContain('Отчёт уже принят');
  expect(session.state.report?.raw.sections.texts).toHaveLength(0);
});

test('an ask needs the briefing first, then finding and current_guess from the first ask', async () => {
  const session = reportSession();
  await session.call('eyes', 'observe', {});
  await session.call('eyes', 'report', REPORT);
  const early = await session.call('brain', 'ask', ASK);
  expect(early.text).toContain('Сначала вызови briefing');
  await session.call('brain', 'briefing', {});
  const bare = await session.call('brain', 'ask', {
    hypothesis: ASK.hypothesis,
    requests: ASK.requests,
  });
  expect(bare.isError).toBe(true);
  expect(bare.text).toContain('GEO_BOT_JOURNAL_FIELD_MISSING');
  expect(bare.text).toContain('из отчёта');
  expect(session.state.asks).toHaveLength(0);
});

test('a request that asks a question or names a place is refused and not counted', async () => {
  const session = await briefed();
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
  expect(session.state.formRejections).toBe(2);
  expect(session.state.guardRejections).toHaveLength(1);
  expect(session.state.asks).toHaveLength(0);
  expect(session.state.broker.hasPending()).toBe(false);
});

test('the eyes answer in their own words with a confidence; the brain reads it masked', async () => {
  const session = await briefed();
  const asked = session.call('brain', 'ask', { ...ASK, control: true });
  const noConfidence = await answerCurrent(session, [
    { n: 1, value: 'жёлтые узкие номера', frame: 2 },
    { n: 2, value: 'not_visible' },
  ]);
  expect(noConfidence.isError).toBe(true);
  expect(noConfidence.text).toContain('укажи confidence');
  const ack = await answerCurrent(session, [
    { n: 1, value: 'жёлтые узкие номера, как на тайских такси', confidence: 'unsure', frame: 2 },
    { n: 2, value: 'not_visible' },
  ]);
  expect(ack.isError).toBeUndefined();
  const reply = await asked;
  expect(reply.text).toContain('жёлтые узкие номера, как на […] такси (неуверенно, кадр 2)');
  expect(reply.text).toContain('не видно');
  const record = session.state.asks[0];
  expect(record?.control).toBe(true);
  expect(record?.findingState).toBe('recorded');
  expect(record?.outcome?.items[0]?.value).toContain('тайских');
  expect(record?.outcome?.items[0]?.confidence).toBe('unsure');
  expect(session.state.maskedInAnswers).toEqual(['тайских']);
});

test('final_guess owes a confidence level and the deciding clue under the report protocol', async () => {
  const session = await briefed();
  const guess = { lat: 35, lng: 139, summary: 'Я прочитал отчёт.', finding: 'Вывеска решила.' };
  const bare = await session.call('brain', 'final_guess', guess);
  expect(bare.isError).toBe(true);
  expect(bare.text).toContain('confidence');
  expect(bare.text).toContain('clue');
  expect(session.state.final).toBeNull();
  const full = await session.call('brain', 'final_guess', {
    ...guess,
    confidence: 'region',
    clue: 'Вывеска латиницей.',
  });
  expect(full.isError).toBeUndefined();
  expect(session.state.final?.confidence).toBe('region');
  expect(session.state.final?.clue).toBe('Вывеска латиницей.');
});

test('a fourth zoom before the report is refused and costs no move', async () => {
  const session = reportSession({ moveLimit: 8 });
  await session.call('eyes', 'observe', {});
  for (const heading of [10, 100, 190]) {
    const look = await session.call('eyes', 'look', { heading, fov: 30 });
    expect(look.isError).toBeUndefined();
  }
  const early = await session.call('eyes', 'look', { heading: 280, fov: 30 });
  expect(early.isError).toBe(true);
  expect(early.text).toContain('До отчёта можно сделать не больше 3 приближений');
  expect(session.state.turnsUsed).toBe(3);
  expect(session.state.earlyLookRefusals).toBe(1);
  await session.call('eyes', 'report', REPORT);
  const later = await session.call('eyes', 'look', { heading: 280, fov: 30 });
  expect(later.isError).toBeUndefined();
  expect(session.state.turnsUsed).toBe(4);
});
