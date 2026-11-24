import { expect, test } from 'bun:test';
import {
  DETECTIVE_BUDGET_HINT,
  fallbackNote,
  minBudgetSec,
  playedStyle,
  styleSuffix,
} from './play-style';

const DETECTIVE = { playStyle: 'detective', budgetSec: 120 } as const;

test('a Detective needs 90 s of budget, an Intuit 60 s', () => {
  expect(minBudgetSec(DETECTIVE)).toBe(90);
  expect(minBudgetSec({ ...DETECTIVE, playStyle: 'intuit' })).toBe(60);
  expect(minBudgetSec({ budgetSec: 60 })).toBe(60);
  expect(DETECTIVE_BUDGET_HINT).toBe('Детективу нужно не меньше 90 с');
});

test('a slot that plays what it is set to has no note', () => {
  expect(playedStyle(DETECTIVE, 120)).toBe('detective');
  expect(fallbackNote(DETECTIVE, 120)).toBeNull();
  expect(playedStyle({ budgetSec: 60 }, 60)).toBe('intuit');
  expect(fallbackNote({ budgetSec: 60 }, 60)).toBeNull();
});

test('a Detective that will play Intuit says why', () => {
  expect(playedStyle(DETECTIVE, 60)).toBe('intuit');
  expect(fallbackNote(DETECTIVE, 60)).toBe(
    'Раунд длится 60 с, а Детективу нужно не меньше 90 с: в этой партии бот сыграет как Интуит',
  );
});

test('the lobby line names the eyes only when they run on another model', () => {
  const slot = {
    ...DETECTIVE,
    harness: 'claude',
    model: 'claude-opus-5-5',
    effort: 'high',
  } as const;
  expect(styleSuffix(slot, 120)).toBe(' · Детектив');
  const split = { ...slot, eyes: { harness: 'codex', model: 'gpt-6-luna' } } as const;
  expect(styleSuffix(split, 120)).toBe(' · Детектив, глаза: codex · gpt-6-luna');
  expect(styleSuffix(split, 60)).toBe('');
  expect(styleSuffix({ ...split, playStyle: 'intuit' }, 120)).toBe('');
});
