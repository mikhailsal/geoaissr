// Value: protects=the price on a Detective's token badge counts both processes or is unknown; fails_when=the price of one process shows as the bot's price while the other reported no usage, or a known pair is not added up; why_new=a role without usage was left out of the sum; seam=a stub price table stands in for the model catalog; no_claim=real catalog prices.
import { expect, test } from 'bun:test';
import type { BotCostEstimate, BotTokenUsage } from '../../../shared/bot-results.ts';
import type { BotSlotConfig } from '../../../shared/storage-schemas.ts';
import { estimateRoles, roleEffort } from './run.ts';

const SLOT: BotSlotConfig = {
  id: 's',
  name: 'n',
  color: 'p-4',
  harness: 'claude',
  model: 'claude-haiku-5-5',
  effort: 'medium',
  moveLimit: 4,
  imageSize: 400,
  budgetSec: 120,
  playStyle: 'detective',
  eyes: { harness: 'codex', model: 'gpt-6-luna' },
  personalityPreset: 'neutral',
  personalityText: '',
  difficultyPreset: 'amateur',
  enabled: true,
};

const PRICE_PER_TOKEN: Record<string, number> = { 'claude-haiku-5-5': 0.01, 'gpt-6-luna': 0.001 };

function tokens(totalTokens: number): BotTokenUsage {
  return { inputTokens: totalTokens, outputTokens: 0, cachedInputTokens: 0, totalTokens };
}

const run = {
  ctx: {
    estimateCost: (model: string, usage: BotTokenUsage): Promise<BotCostEstimate> =>
      Promise.resolve({
        costUsd: usage.totalTokens * (PRICE_PER_TOKEN[model] ?? 0),
        matchedModelId: model,
      }),
  },
  params: { slot: SLOT },
};

test('the price of a Detective is the sum of both processes, each at its own model', async () => {
  const both = await estimateRoles(run, { brain: tokens(300), eyes: tokens(400) });
  expect(both?.costUsd).toBeCloseTo(300 * 0.01 + 400 * 0.001, 6);
  expect(both?.matchedModelId).toBe('claude-haiku-5-5 + gpt-6-luna');
});

test('the price stays unknown while one process has no usage to price', async () => {
  // The eyes on agy may report no counters: the brain's price alone is not the bot's price.
  const brainOnly = await estimateRoles(run, { brain: tokens(300) });
  expect(brainOnly?.costUsd).toBeNull();
  expect(brainOnly?.matchedModelId).toBe('claude-haiku-5-5');
  const eyesOnly = await estimateRoles(run, { eyes: tokens(400) });
  expect(eyesOnly?.costUsd).toBeNull();
});

// Value: protects=each process of a Detective launches at its own effort; fails_when=the eyes launch at the brain's effort or ignore eyesEffort; why_new=the eyes had one fixed effort; seam=none; no_claim=how a CLI reads the effort flag.
test('the brain launches at the slot effort and the eyes at theirs, low by default', () => {
  expect(roleEffort(SLOT, 'brain')).toBe('medium');
  expect(roleEffort(SLOT, 'eyes')).toBe('low');
  expect(roleEffort({ ...SLOT, eyesEffort: 'high' }, 'eyes')).toBe('high');
  expect(roleEffort({ ...SLOT, eyesEffort: 'high' }, 'brain')).toBe('medium');
});
