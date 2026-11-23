import { expect, test } from 'bun:test';
import { DETECTIVE_BUDGET_HINT, fallbackNote, minBudgetSec, playedStyle } from './play-style';

const DETECTIVE = { playStyle: 'detective', harness: 'claude', budgetSec: 120 } as const;

test('a Detective needs 90 s of budget, an Intuit 60 s', () => {
  expect(minBudgetSec(DETECTIVE)).toBe(90);
  expect(minBudgetSec({ ...DETECTIVE, playStyle: 'intuit' })).toBe(60);
  expect(minBudgetSec({ harness: 'claude', budgetSec: 60 })).toBe(60);
  expect(DETECTIVE_BUDGET_HINT).toBe('Детективу нужно не меньше 90 с');
});

test('a slot that plays what it is set to has no note', () => {
  expect(playedStyle(DETECTIVE, 120)).toBe('detective');
  expect(fallbackNote(DETECTIVE, 120)).toBeNull();
  expect(playedStyle({ harness: 'codex', budgetSec: 60 }, 60)).toBe('intuit');
  expect(fallbackNote({ harness: 'codex', budgetSec: 60 }, 60)).toBeNull();
});

test('a Detective that will play Intuit says why', () => {
  expect(playedStyle(DETECTIVE, 60)).toBe('intuit');
  expect(fallbackNote(DETECTIVE, 60)).toBe(
    'Раунд длится 60 с, а Детективу нужно не меньше 90 с: в этой партии бот сыграет как Интуит',
  );
  expect(fallbackNote({ ...DETECTIVE, harness: 'codex' }, 120)).toBe(
    'Детектив пока работает только с claude: с харнессом codex бот сыграет как Интуит',
  );
});
