import { expect, test } from 'bun:test';
import { effectiveRemainingSec } from './runner-handlers.ts';

// protects=bots read the engine's shortened round end; fails_when=runner keeps using the slot budget after all humans confirmed; no_claim=model reaction to the nudge.
test('effectiveRemainingSec uses the earlier of slot budget end and engine round end', () => {
  const base = { budgetSec: 90, startedAt: 10_000 };
  expect(effectiveRemainingSec({ ...base, roundDeadlineAt: null, now: 40_000 })).toBe(60);
  // All humans confirmed: the engine moved the round end to 50 s.
  expect(effectiveRemainingSec({ ...base, roundDeadlineAt: 50_000, now: 40_000 })).toBe(10);
  // An engine end later than the slot budget does not extend the bot.
  expect(effectiveRemainingSec({ ...base, roundDeadlineAt: 500_000, now: 40_000 })).toBe(60);
  expect(effectiveRemainingSec({ ...base, roundDeadlineAt: 50_000, now: 60_000 })).toBe(0);
});
