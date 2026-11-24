import { expect, test } from 'bun:test';
import {
  DETECTIVE_MIN_BUDGET_SEC,
  eyesDiffer,
  eyesModel,
  resolvePlayStyle,
  slotHarnesses,
  styleFallbacks,
  visionSubject,
} from './play-style.ts';

const DETECTIVE = { playStyle: 'detective', budgetSec: 120 } as const;

test('a slot without a style, or set to Intuit, plays Intuit with no fallback note', () => {
  expect(resolvePlayStyle({ budgetSec: 120 }, 120)).toEqual({ style: 'intuit' });
  expect(resolvePlayStyle({ ...DETECTIVE, playStyle: 'intuit' }, 120)).toEqual({
    style: 'intuit',
  });
});

test('a Detective plays as one when the time is enough, on any harness', () => {
  expect(resolvePlayStyle(DETECTIVE, 120)).toEqual({ style: 'detective' });
  expect(resolvePlayStyle({ ...DETECTIVE, budgetSec: 90 }, 90)).toEqual({ style: 'detective' });
  expect(DETECTIVE_MIN_BUDGET_SEC).toBe(90);
});

test('a Detective falls back to Intuit, with the reason, when the time is short', () => {
  // The round duration caps the budget, so a short round is a budget fallback too.
  expect(resolvePlayStyle(DETECTIVE, 60)).toEqual({ style: 'intuit', fallback: 'budget' });
  expect(resolvePlayStyle({ ...DETECTIVE, budgetSec: 89 }, 600)).toEqual({
    style: 'intuit',
    fallback: 'budget',
  });
});

test('the fallbacks of a round list only the slots that asked for Detective and cannot have it', () => {
  const slots = [
    { id: 'plays', ...DETECTIVE },
    { id: 'short', ...DETECTIVE, budgetSec: 60 },
    { id: 'intuit', budgetSec: 60 },
  ];
  expect(styleFallbacks(slots, 120)).toEqual({ short: 'budget' });
  expect(styleFallbacks(slots, 60)).toEqual({ plays: 'budget', short: 'budget' });
});

const BRAIN = {
  playStyle: 'detective',
  harness: 'claude',
  model: 'claude-opus-5-5',
  effort: 'high',
} as const;

test('the eyes run on the brain model unless the slot names their own', () => {
  expect(eyesModel(BRAIN)).toEqual({ harness: 'claude', model: 'claude-opus-5-5' });
  expect(eyesDiffer(BRAIN)).toBe(false);
  const split = { ...BRAIN, eyes: { harness: 'codex', model: 'gpt-6-luna' } } as const;
  expect(eyesModel(split)).toEqual({ harness: 'codex', model: 'gpt-6-luna' });
  expect(eyesDiffer(split)).toBe(true);
  expect(eyesDiffer({ ...BRAIN, eyes: { harness: 'claude', model: 'claude-opus-5-5' } })).toBe(
    false,
  );
});

test('a Detective launches the harness of each role; an Intuit only its own', () => {
  const split = { ...BRAIN, eyes: { harness: 'agy', model: 'gemini-3.8-flash-low' } } as const;
  expect(slotHarnesses(split)).toEqual(['claude', 'agy']);
  expect(slotHarnesses({ ...split, eyes: { harness: 'claude', model: 'x' } })).toEqual(['claude']);
  expect(slotHarnesses({ ...split, playStyle: 'intuit' })).toEqual(['claude']);
});

test('the vision check tests the eyes of a Detective at their low effort', () => {
  const split = { ...BRAIN, eyes: { harness: 'codex', model: 'gpt-6-luna' } } as const;
  expect(visionSubject(split)).toEqual({ harness: 'codex', model: 'gpt-6-luna', effort: 'low' });
  expect(visionSubject(BRAIN)).toEqual({
    harness: 'claude',
    model: 'claude-opus-5-5',
    effort: 'low',
  });
  expect(visionSubject({ ...split, playStyle: 'intuit' })).toEqual({
    harness: 'claude',
    model: 'claude-opus-5-5',
    effort: 'high',
  });
});
