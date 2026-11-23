// Value: protects=the texts the brain and eyes read: every answer status, frame notes, urgency, journal requests; fails_when=a status line, the 15 s final nudge or the drive/text wording changes; why_new=session tests cover only a few statuses; seam=none; no_claim=how a model reacts to the text
import { expect, test } from 'bun:test';
import type { AskOutcome, Question, SettledItem } from './broker.ts';
import {
  brainStatusLines,
  formatAskOutcome,
  formatRequestForEyes,
  journalRequests,
} from './format.ts';
import { createSessionState, type SessionOptions } from './state.ts';

function stateWith(leftMs: number, moveEnabled = true) {
  const opts = { getRemainingMs: () => leftMs, moveLimit: 4, moveEnabled } as SessionOptions;
  const s = createSessionState(opts);
  s.turnsUsed = 1;
  s.frames.push(
    { n: 1, action: 'observe', heading: 0, fromStartM: 0, fromStartDir: null },
    { n: 5, action: 'move', heading: 45, fromStartM: 640.4, fromStartDir: 'СВ' },
  );
  return s;
}

const DESCRIBE: Question = { kind: 'describe', topic: 'номера машин' };
const TEXT: Question = { kind: 'text', target: 'крупная вывеска' };
const DRIVE: Question = { kind: 'drive', heading: 44.6, distance_m: 200.4, topic: 'указатели' };

function item(n: number, question: Question, rest: Partial<SettledItem>): SettledItem {
  return { n, question, status: 'answered', value: null, frame: null, ...rest };
}

test('every answer status reads differently and frames far from the start are located', () => {
  const s = stateWith(60_000);
  const items = [
    item(1, DESCRIBE, { value: 'жёлтые', confidence: 'unsure', frame: 5 }),
    item(2, TEXT, { value: 'LAWSON', frame: 1 }),
    item(3, DRIVE, { status: 'abstained', value: 'no_road' }),
    item(4, DESCRIBE, { status: 'abstained', value: 'видно плохо' }),
    item(5, TEXT, { status: 'timeout' }),
    item(6, DESCRIBE, { status: 'eyes_down' }),
  ];
  const outcome: AskOutcome = { requestId: 'r7', items, cycleMs: 5, settledBy: 'answer' };
  expect(formatAskOutcome(s, outcome).split('\n')).toEqual([
    'Ответы на запрос r7:',
    '1. «номера машин»: жёлтые (неуверенно, кадр 5, 640 м к СВ от старта)',
    '2. Текст «крупная вывеска»: "LAWSON" (кадр 1)',
    '3. Проезд 200 м на 45°, «указатели»: проехать не удалось',
    '4. «номера машин»: видно плохо',
    '5. Текст «крупная вывеска»: напарник не ответил вовремя',
    '6. «номера машин»: нет ответа, процесс напарника завершился',
    'Осталось времени: 60 с. Платных ходов у напарника: 3.',
  ]);
});

test('with 15 s or less left the brain is told to give the final guess at once', () => {
  expect(brainStatusLines(stateWith(16_000))).toHaveLength(1);
  const last = brainStatusLines(stateWith(15_000));
  expect(last).toHaveLength(2);
  expect(last[1]).toContain('final_guess');
  expect(brainStatusLines(stateWith(-5))[0]).toContain('Осталось времени: 0 с.');
});

test('the request for the eyes names each kind, the frames, and the longer drive timeout', () => {
  const plain = formatRequestForEyes(stateWith(60_000), {
    id: 'r1',
    questions: [DESCRIBE, TEXT],
  });
  expect(plain).toContain('1. Опиши своими словами');
  expect(plain).toContain('2. Перепиши дословно текст: «крупная вывеска»');
  expect(plain).toContain('Выданные кадры: 1 (observe 0°), 5 (move 45°).');
  expect(plain).toContain('(look и move): 3');
  expect(plain).toContain('на запрос до 30 с');
  const drive = formatRequestForEyes(stateWith(60_000, false), { id: 'r2', questions: [DRIVE] });
  expect(drive).toContain('move(heading=45, distance_m=200)');
  expect(drive).toContain('на запрос до 45 с');
  expect(drive).toContain('(look): 3');
  expect(
    formatRequestForEyes(
      createSessionState({
        getRemainingMs: () => 1,
        moveLimit: 1,
        moveEnabled: true,
      } as SessionOptions),
      { id: 'r3', questions: [DESCRIBE] },
    ),
  ).toContain('Кадров пока нет');
});

test('journal requests are pending until settled and carry the drive geometry', () => {
  expect(journalRequests([DRIVE, TEXT], null)).toEqual([
    { n: 1, kind: 'drive', text: 'указатели', heading: 44.6, distanceM: 200.4, status: 'pending' },
    { n: 2, kind: 'text', text: 'крупная вывеска', status: 'pending' },
  ]);
  const settled = journalRequests(
    [TEXT],
    [item(1, TEXT, { value: 'LAWSON', confidence: 'sure', frame: 2 })],
  );
  expect(settled).toEqual([
    {
      n: 1,
      kind: 'text',
      text: 'крупная вывеска',
      status: 'answered',
      value: 'LAWSON',
      confidence: 'sure',
      frame: 2,
    },
  ]);
});
