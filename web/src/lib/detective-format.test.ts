import { expect, test } from 'bun:test';
import type { JournalRequest } from '$shared/bot-journal';
import { answerLine, confidenceLine, reportGroups, requestLine } from './detective-format';

function request(partial: Partial<JournalRequest>): JournalRequest {
  return { n: 1, kind: 'describe', text: 'разметка', status: 'answered', ...partial };
}

test('a request reads as what the brain asked for', () => {
  expect(requestLine(request({}))).toBe('разметка');
  expect(requestLine(request({ kind: 'text', text: 'вывеска, кадр 2' }))).toBe(
    'Прочитать: вывеска, кадр 2',
  );
  expect(
    requestLine(request({ kind: 'drive', text: 'указатели', heading: 359.6, distanceM: 400 })),
  ).toBe('Проехать 400 м на 360° и описать: указатели');
});

test('an answer shows the eyes words with their confidence and frame', () => {
  expect(answerLine(request({ value: 'белая осевая', confidence: 'unsure', frame: 5 }))).toEqual({
    text: 'белая осевая',
    meta: 'неуверенно · кадр 5',
    answered: true,
  });
  expect(answerLine(request({ value: 'белая осевая', confidence: 'sure' })).meta).toBe('уверенно');
  expect(answerLine(request({ value: 'белая осевая' })).meta).toBeNull();
});

test('a request without an answer says why, in words', () => {
  const statusText = (partial: Partial<JournalRequest>) => answerLine(request(partial));
  expect(statusText({ status: 'abstained', value: 'not_visible' })).toEqual({
    text: 'не видно',
    meta: null,
    answered: false,
  });
  expect(statusText({ status: 'abstained', value: 'unreadable' }).text).toBe('неразборчиво');
  expect(statusText({ status: 'abstained', value: 'no_road' }).text).toBe('проехать не удалось');
  expect(statusText({ status: 'timeout' }).text).toBe('глаза не ответили');
  expect(statusText({ status: 'eyes_down' }).text).toBe('глаза отключились');
  expect(statusText({ status: 'pending' }).text).toBe('раунд закончился раньше ответа');
});

test('the report is grouped by section in the fixed order, without empty sections', () => {
  const groups = reportGroups([
    { section: 'nature', text: 'Солнце: на юге', frame: 3 },
    { section: 'texts', text: '«TAXI»', frame: 2 },
    { section: 'nature', text: 'пальмы', frame: 4 },
  ]);
  expect(groups.map((g) => [g.title, g.lines.length])).toEqual([
    ['Текст дословно', 1],
    ['Природа', 2],
  ]);
});

test('the final confidence is spelled out', () => {
  expect(confidenceLine('country')).toBe('Уверенность: уверен в стране');
  expect(confidenceLine('region')).toBe('Уверенность: уверен в регионе');
  expect(confidenceLine('guess')).toBe('Уверенность: догадка');
  expect(confidenceLine(undefined)).toBeNull();
});
