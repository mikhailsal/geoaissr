import { expect, test } from 'bun:test';
import {
  formatDistanceRu,
  formatPointsRu,
  formatRoundsRu,
  formatTimerClock,
  formatTurnsRu,
} from './format.ts';

test('Russian pluralization formats rounds, points, and turns correctly', () => {
  expect(formatRoundsRu(1)).toBe('1 раунд');
  expect(formatRoundsRu(2)).toBe('2 раунда');
  expect(formatRoundsRu(5)).toBe('5 раундов');
  expect(formatRoundsRu(21)).toBe('21 раунд');

  expect(formatPointsRu(4872)).toMatch(/^4[\s\u00a0\u202f]872 очка$/);
  expect(formatPointsRu(5000)).toMatch(/^5[\s\u00a0\u202f]000 очков$/);
  expect(formatPointsRu(1)).toBe('1 очко');

  expect(formatTurnsRu(0)).toBe('0 ходов');
  expect(formatTurnsRu(1)).toBe('1 ход');
  expect(formatTurnsRu(4)).toBe('4 хода');
});

test('distance and timer formatting match specification', () => {
  expect(formatDistanceRu(0.84)).toBe('840 м');
  expect(formatDistanceRu(12345.4)).toMatch(/^12[\s\u00a0\u202f]345 км$/);
  expect(formatTimerClock(72_000)).toBe('1:12');
  expect(formatTimerClock(4_100)).toBe('0:05');
  expect(formatTimerClock(-500)).toBe('0:00');
});
