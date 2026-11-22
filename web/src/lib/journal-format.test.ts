import { expect, test } from 'bun:test';
import type { JournalStep } from '$shared/bot-journal';
import {
  disclosureLabel,
  findingLine,
  formatKm,
  frameName,
  pinLine,
  shiftLabel,
  stepTitle,
} from './journal-format';

function step(partial: Partial<JournalStep>): JournalStep {
  return { index: 1, kind: 'look', frames: [], findingState: 'recorded', atMs: 0, ...partial };
}

const frame = (params: NonNullable<JournalStep['frames'][number]['params']>) => ({
  label: 'x',
  thumbUrl: '/t',
  params,
});

test('step titles come from action and camera params', () => {
  expect(stepTitle(step({ kind: 'observe', index: 0 }))).toBe('Первый взгляд');
  expect(stepTitle(step({ frames: [frame({ heading: 90, fov: 45 })] }))).toBe(
    'Зум 2.0× · азимут 90°',
  );
  expect(stepTitle(step({ frames: [frame({ heading: 10, fov: 90 })] }))).toBe(
    'Осмотр · азимут 10°',
  );
  expect(stepTitle(step({ kind: 'move', frames: [frame({ heading: 0, step: 2 })] }))).toBe(
    'Шаг 2 · азимут 0°',
  );
  expect(stepTitle(step({ kind: 'move' }))).toBe('Перемещение');
  // A long move shows the road distance it covered.
  expect(
    stepTitle(step({ kind: 'move', frames: [frame({ heading: 40, step: 2, distanceM: 432 })] })),
  ).toBe('Шаг 2 · азимут 40° · 432 м');
  expect(stepTitle(step({}))).toBe('Осмотр');
});

test('frame names follow «Кадр шага N: действие»', () => {
  expect(frameName(step({ kind: 'move', index: 2 }), 'x')).toBe('Кадр шага 2: Перемещение');
  expect(frameName(step({ kind: 'observe', index: 0 }), 'Север')).toBe(
    'Кадр шага 0: Первый взгляд — Север',
  );
});

test('disclosure label pluralizes steps', () => {
  expect(disclosureLabel(1)).toBe('Ход за ходом (1 шаг)');
  expect(disclosureLabel(2)).toBe('Ход за ходом (2 шага)');
  expect(disclosureLabel(5)).toBe('Ход за ходом (5 шагов)');
  expect(disclosureLabel(11)).toBe('Ход за ходом (11 шагов)');
  expect(disclosureLabel(21)).toBe('Ход за ходом (21 шаг)');
});

test('shift labels are text', () => {
  expect(shiftLabel('excluded')).toBe('Отпало');
  expect(shiftLabel('weaker')).toBe('Менее вероятно');
  expect(shiftLabel('stronger')).toBe('Более вероятно');
});

test('pin lines cover first, moved, zero and missing points', () => {
  expect(pinLine(step({ currentGuess: { lat: 1, lng: 2 } }))).toBe('первая точка');
  expect(pinLine(step({ movedKm: 0 }))).toBe('точка не сдвинулась');
  expect(pinLine(step({ movedKm: 0.04 }))).toBe('точка сдвинулась меньше чем на 0,1 км');
  expect(pinLine(step({ movedKm: 2.54 }))).toBe('точка сдвинулась на 2,5 км');
  expect(pinLine(step({ movedKm: 1234.4 }))).toContain('1');
  expect(pinLine(step({ pointMissing: true }))).toBe('новая точка не записана');
  expect(pinLine(step({}))).toBeNull();
  expect(formatKm(12.6)).toBe('13');
});

test('finding lines handle every state', () => {
  expect(findingLine(step({ finding: 'Видна разметка' }))?.placeholder).toBe(false);
  expect(findingLine(step({ findingState: 'missing' }))?.text).toBe('вывод не записан');
  expect(findingLine(step({ findingState: 'round-ended' }))?.text).toBe(
    'раунд закончился раньше вывода',
  );
  expect(findingLine(step({ findingState: 'pending' }))?.text).toBe(
    'раунд закончился раньше вывода',
  );
  expect(findingLine(step({ findingState: 'recorded' }))).toBeNull();
});
