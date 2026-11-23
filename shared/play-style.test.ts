import { expect, test } from 'bun:test';
import { DETECTIVE_MIN_BUDGET_SEC, resolvePlayStyle, styleFallbacks } from './play-style.ts';

const DETECTIVE = { playStyle: 'detective', harness: 'claude', budgetSec: 120 } as const;

test('a slot without a style, or set to Intuit, plays Intuit with no fallback note', () => {
  expect(resolvePlayStyle({ harness: 'claude', budgetSec: 120 }, 120)).toEqual({ style: 'intuit' });
  expect(resolvePlayStyle({ ...DETECTIVE, playStyle: 'intuit' }, 120)).toEqual({
    style: 'intuit',
  });
});

test('a Detective plays as one when its harness supports it and the time is enough', () => {
  expect(resolvePlayStyle(DETECTIVE, 120)).toEqual({ style: 'detective' });
  expect(resolvePlayStyle({ ...DETECTIVE, budgetSec: 90 }, 90)).toEqual({ style: 'detective' });
  expect(DETECTIVE_MIN_BUDGET_SEC).toBe(90);
});

test('a Detective falls back to Intuit, with the reason, when it cannot play as one', () => {
  // The round duration caps the budget, so a short round is a budget fallback too.
  expect(resolvePlayStyle(DETECTIVE, 60)).toEqual({ style: 'intuit', fallback: 'budget' });
  expect(resolvePlayStyle({ ...DETECTIVE, budgetSec: 89 }, 600)).toEqual({
    style: 'intuit',
    fallback: 'budget',
  });
  expect(resolvePlayStyle({ ...DETECTIVE, harness: 'codex' }, 600)).toEqual({
    style: 'intuit',
    fallback: 'harness',
  });
});

test('the fallbacks of a round list only the slots that asked for Detective and cannot have it', () => {
  const slots = [
    { id: 'plays', ...DETECTIVE },
    { id: 'wrong-cli', ...DETECTIVE, harness: 'codex' },
    { id: 'intuit', harness: 'codex', budgetSec: 60 },
  ];
  expect(styleFallbacks(slots, 120)).toEqual({ 'wrong-cli': 'harness' });
  expect(styleFallbacks(slots, 60)).toEqual({ plays: 'budget', 'wrong-cli': 'harness' });
});
