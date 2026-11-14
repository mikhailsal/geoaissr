import { expect, test } from 'bun:test';
import path from 'node:path';
import { botSlotIdSchema } from '../shared/storage-schemas.ts';
import { joinUnder } from './paths.ts';

test('joinUnder keeps bot work dirs inside the run dir', () => {
  const root = path.resolve('/tmp/geo-run');
  expect(joinUnder(root, 'm1', 'r1-g0', 'bot-abc-1')).toBe(
    path.join(root, 'm1', 'r1-g0', 'bot-abc-1'),
  );
  expect(() => joinUnder(root, 'm1', '../../..')).toThrow();
  expect(() => joinUnder(root, '..', 'geo-run-sibling')).toThrow();
  expect(() => joinUnder(root, '/etc')).toThrow();
  expect(() => joinUnder(root, '.')).toThrow();
});

test('bot slot ids accept generated ids and reject path syntax', () => {
  expect(botSlotIdSchema.safeParse('bot-lq3x9k-1').success).toBe(true);
  for (const bad of ['', '../x', 'a/b', 'a\\b', '.', 'x'.repeat(65), 'бот']) {
    expect(botSlotIdSchema.safeParse(bad).success).toBe(false);
  }
});
