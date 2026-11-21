import { expect, test } from 'bun:test';
import {
  choiceLabelRu,
  duplicateOption,
  normalizeChoiceValue,
  type ChoiceQuestion,
} from './choice.ts';
import { makeSession } from './test-helpers.ts';
import type { DetectiveSession } from './session.ts';

const Q: ChoiceQuestion = {
  kind: 'choice',
  question: 'Какие крыши у домов?',
  options: ['Скатная черепица', 'плоские бетонные', 'металл'],
};

const CHOICE_ASK = {
  hypothesis: 'Крыши и текст разделят версии.',
  questions: [
    { kind: 'choice', question: Q.question, options: Q.options },
    { kind: 'text', target: 'все надписи на вывесках' },
  ],
};

test('choice values are option numbers, exact option texts or the three special values', () => {
  expect(normalizeChoiceValue(Q, '2')).toBe('2');
  expect(normalizeChoiceValue(Q, ' 3) ')).toBe('3');
  expect(normalizeChoiceValue(Q, 'скатная  черепица')).toBe('1');
  expect(normalizeChoiceValue(Q, 'none_of_these')).toBe('none_of_these');
  expect(normalizeChoiceValue(Q, 'not_visible')).toBe('not_visible');
  expect(normalizeChoiceValue(Q, '4')).toBeNull();
  expect(normalizeChoiceValue(Q, '0')).toBeNull();
  expect(normalizeChoiceValue(Q, 'шифер')).toBeNull();
  expect(choiceLabelRu(Q, '2')).toBe('плоские бетонные');
  expect(choiceLabelRu(Q, 'none_of_these')).toBe('ни один вариант не подходит');
  expect(choiceLabelRu(Q, 'unreadable')).toBe('неразборчиво');
  expect(duplicateOption(Q)).toBeNull();
  expect(duplicateOption({ ...Q, options: ['металл', ' Металл'] })).toBe(' Металл');
});

function choiceSession(overrides: Parameters<typeof makeSession>[0] = {}): DetectiveSession {
  return makeSession({ protocol: 'choice', ...overrides });
}

async function deliver(session: DetectiveSession): Promise<string> {
  await session.call('eyes', 'next_request', {});
  const req = session.state.broker.current();
  if (!req) throw new Error('no request');
  return req.id;
}

test('a choice question reaches the eyes with numbered options and the brain reads the option', async () => {
  const session = choiceSession();
  await session.call('eyes', 'observe', {});
  const asked = session.call('brain', 'ask', CHOICE_ASK);
  await session.call('eyes', 'next_request', {});
  const id = session.state.broker.current()?.id ?? '';
  const bad = await session.call('eyes', 'answer', {
    request_id: id,
    answers: [{ n: 1, value: 'шифер', frame: 1 }],
  });
  expect(bad.text).toContain('не номер варианта (1–3)');
  const ok = await session.call('eyes', 'answer', {
    request_id: id,
    answers: [
      { n: 1, value: 'плоские бетонные', frame: 2 },
      { n: 2, value: 'ローソン', frame: 2 },
    ],
  });
  expect(ok.isError).toBeUndefined();
  const reply = (await asked).text;
  expect(reply).toContain('«Какие крыши у домов?»: плоские бетонные (кадр 2)');
  expect(reply).toContain('"ローソン" (кадр 2)');
  expect(session.state.asks[0]?.outcome?.items[0]?.value).toBe('2');
});

test('the catalog protocol refuses choice questions and the choice protocol refuses features', async () => {
  const catalog = makeSession();
  expect((await catalog.call('brain', 'ask', CHOICE_ASK)).isError).toBe(true);
  const choice = choiceSession({ answerSource: 'labels' });
  const feature = await choice.call('brain', 'ask', {
    hypothesis: 'h',
    questions: [{ kind: 'feature', feature: 'driving_side' }],
  });
  expect(feature.isError).toBe(true);
  expect(choice.state.asks).toHaveLength(0);
});

test('the guard checks the question and every option; script names pass', async () => {
  const session = choiceSession({ answerSource: 'labels' });
  const option = await session.call('brain', 'ask', {
    hypothesis: 'h',
    questions: [{ kind: 'choice', question: 'Какие дома?', options: ['японские', 'панельные'] }],
  });
  expect(option.text).toContain('GEO_DETECTIVE_PLACE_WORD');
  const city = await session.call('brain', 'ask', {
    hypothesis: 'h',
    questions: [{ kind: 'choice', question: 'Как в Токио?', options: ['да', 'нет'] }],
  });
  expect(city.text).toContain('«токио»');
  const dup = await session.call('brain', 'ask', {
    hypothesis: 'h',
    questions: [{ kind: 'choice', question: 'Какие столбы?', options: ['бетон', 'Бетон'] }],
  });
  expect(dup.text).toContain('повторяется');
  expect(session.state.asks).toHaveLength(0);
  const script = await session.call('brain', 'ask', {
    hypothesis: 'h',
    questions: [
      {
        kind: 'choice',
        question: 'Какое письмо на вывесках?',
        options: ['латиница', 'грузинское письмо', 'японская кана', 'арабская вязь'],
      },
    ],
  });
  expect(script.isError).toBeUndefined();
  expect(session.state.guardRejections).toEqual(['японские', 'токио']);
});

test('with requireZoom an abstention without a look is refused while looks and time remain', async () => {
  const session = choiceSession({ requireZoom: true, askTimeoutMs: 30_000 });
  await session.call('eyes', 'observe', {});
  const asked = session.call('brain', 'ask', CHOICE_ASK);
  const id = await deliver(session);
  const answers = [
    { n: 1, value: '1', frame: 1 },
    { n: 2, value: 'unreadable' },
  ];
  const refused = await session.call('eyes', 'answer', { request_id: id, answers });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain('сделай хотя бы один look');
  await session.call('eyes', 'look', { heading: 20, fov: 30 });
  const accepted = await session.call('eyes', 'answer', { request_id: id, answers });
  expect(accepted.isError).toBeUndefined();
  await asked;
  expect(session.state.zoomRefusals).toBe(1);
  expect(session.state.eyesAnswers.map((a) => a.result)).toEqual(['zoom', 'settled']);
});

test('requireZoom lets an abstention through when no looks remain or the rule is off', async () => {
  const spent = choiceSession({ requireZoom: true, moveLimit: 0 });
  await spent.call('eyes', 'observe', {});
  const asked = spent.call('brain', 'ask', CHOICE_ASK);
  const id = await deliver(spent);
  const answers = [{ n: 2, value: 'not_visible' }];
  expect((await spent.call('eyes', 'answer', { request_id: id, answers })).isError).toBeUndefined();
  await asked;
  const off = choiceSession();
  await off.call('eyes', 'observe', {});
  const asked2 = off.call('brain', 'ask', CHOICE_ASK);
  const id2 = await deliver(off);
  expect((await off.call('eyes', 'answer', { request_id: id2, answers })).isError).toBeUndefined();
  await asked2;
});

test('requireZoom lets an abstention through when the ask is about to time out', async () => {
  let now = 0;
  const session = choiceSession({ requireZoom: true, now: () => now, askTimeoutMs: 30_000 });
  await session.call('eyes', 'observe', {});
  const asked = session.call('brain', 'ask', CHOICE_ASK);
  const id = await deliver(session);
  now = 19_000;
  const reply = await session.call('eyes', 'answer', {
    request_id: id,
    answers: [{ n: 1, value: 'not_visible' }],
  });
  expect(reply.isError).toBeUndefined();
  await asked;
});
