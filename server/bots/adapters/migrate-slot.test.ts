// Value: protects=a saved Detective slot keeps its eyes and the stored vision check across the model-alias migration; fails_when=the eyes keep an alias, or a check of the eyes' model is rewritten to the brain's or left stale; why_new=migrateSavedBotSlot gained the eyes branch with no test; seam=none; no_claim=real alias tables beyond claude (harnesses.json).
import { expect, test } from 'bun:test';
import type { BotSlotConfig } from '../../../shared/storage-schemas.ts';
import { migrateSavedBotSlot } from './shared.ts';

const SAVED: BotSlotConfig = {
  id: 'slot-1',
  name: 'Сыщик',
  color: 'p-4',
  harness: 'claude',
  model: 'sonnet',
  effort: 'low',
  moveLimit: 4,
  imageSize: 400,
  budgetSec: 120,
  playStyle: 'detective',
  personalityPreset: 'neutral',
  personalityText: '',
  difficultyPreset: 'amateur',
  enabled: true,
};

const CHECK = {
  passed: true,
  elapsedMs: 10,
  effort: 'low',
  imageSize: 400,
  checkedAt: 'now',
} as const;

test('the migration resolves the eyes alias and follows the check to the model it tested', () => {
  const split: BotSlotConfig = { ...SAVED, eyes: { harness: 'claude', model: 'haiku' } };
  const migrated = migrateSavedBotSlot(split);
  expect(migrated.model).toBe('claude-sonnet-5-5');
  expect(migrated.eyes).toEqual({ harness: 'claude', model: 'claude-haiku-5-5' });

  const eyesChecked = migrateSavedBotSlot({
    ...split,
    lastVisionCheck: { ...CHECK, model: 'haiku' },
  });
  expect(eyesChecked.lastVisionCheck?.model).toBe('claude-haiku-5-5');

  const brainChecked = migrateSavedBotSlot({
    ...SAVED,
    lastVisionCheck: { ...CHECK, model: 'sonnet' },
  });
  expect(brainChecked.lastVisionCheck?.model).toBe('claude-sonnet-5-5');
  expect(brainChecked.eyes).toBeUndefined();

  const stale = { ...CHECK, model: 'opus' };
  const other = migrateSavedBotSlot({ ...split, lastVisionCheck: stale });
  expect(other.lastVisionCheck).toEqual(stale);
});
