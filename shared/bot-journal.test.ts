import { expect, test } from 'bun:test';
import {
  botJournalSchema,
  parseShiftsInput,
  shiftsSchema,
  summarySchema,
  SHIFTS_MAX,
  SUMMARY_MAX_LEN,
} from './bot-journal.ts';

const shift = { version: 'Польша', effect: 'excluded', because: 'Знак с кириллицей' } as const;

test('shifts allow at most three entries with a known effect', () => {
  expect(shiftsSchema.safeParse(Array(SHIFTS_MAX).fill(shift)).success).toBe(true);
  expect(shiftsSchema.safeParse(Array(SHIFTS_MAX + 1).fill(shift)).success).toBe(false);
  expect(shiftsSchema.safeParse([{ ...shift, effect: 'gone' }]).success).toBe(false);
});

test('summary is required text of at most 600 characters', () => {
  expect(summarySchema.safeParse('я'.repeat(SUMMARY_MAX_LEN)).success).toBe(true);
  expect(summarySchema.safeParse('я'.repeat(SUMMARY_MAX_LEN + 1)).success).toBe(false);
  expect(summarySchema.safeParse('   ').success).toBe(false);
});

test('lenient ingress drops malformed shifts and caps the list at three', () => {
  const parsed = parseShiftsInput([{ version: 'x' }, shift, shift, shift, shift]);
  expect(parsed).toHaveLength(SHIFTS_MAX);
  expect(parseShiftsInput('nope')).toBeUndefined();
});

test('a journal without a summary or findings still parses', () => {
  const step = { index: 0, kind: 'observe', frames: [], findingState: 'round-ended', atMs: 0 };
  expect(botJournalSchema.safeParse({ steps: [step] }).success).toBe(true);
});
