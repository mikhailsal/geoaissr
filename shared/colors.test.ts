import { expect, test } from 'bun:test';
import {
  PARTICIPANT_COLOR_IDS,
  PARTICIPANT_COLORS,
  contrastRatio,
  getParticipantColor,
  isColorAvailable,
  pickFirstFreeColor,
} from './colors.ts';

test('all 12 participant colors meet >= 4.5:1 contrast with chosen ink', () => {
  expect(PARTICIPANT_COLORS).toHaveLength(12);
  for (const color of PARTICIPANT_COLORS) {
    const ratio = contrastRatio(color.hex, color.inkHex);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});

test('yellow accent #FFD23F is excluded from participant palette', () => {
  const hexes = PARTICIPANT_COLORS.map((c) => c.hex.toUpperCase());
  expect(hexes).not.toContain('#FFD23F');
});

test('pickFirstFreeColor returns first unused color and null if all 12 taken', () => {
  expect(pickFirstFreeColor([])).toBe('p-1');
  expect(pickFirstFreeColor(['p-1', 'p-3'])).toBe('p-2');
  expect(pickFirstFreeColor(PARTICIPANT_COLOR_IDS)).toBeNull();
});

test('isColorAvailable rejects taken color and allows free color', () => {
  expect(isColorAvailable('p-2', ['p-1', 'p-2'])).toBe(false);
  expect(isColorAvailable('p-3', ['p-1', 'p-2'])).toBe(true);
});

test('getParticipantColor resolves metadata and ink token', () => {
  const c = getParticipantColor('p-1');
  expect(c.labelRu).toBe('оранжевый');
  expect(c.cssVar).toBe('--p-1');
});
