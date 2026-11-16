import { expect, test } from 'bun:test';
import {
  finalGuessInputSchema,
  draftGuessInputSchema,
  parseGuessInput,
} from '../../shared/bot-tools.ts';
import { createBotToolQueue, type BotSessionHandlers } from './queue.ts';
import { buildBotRoundPrompt } from './prompt.ts';

// Found by /qa on 2026-11-16
// Report: /tmp/geoaissr-qa-20261116/qa-report-geoaissr-2026-11-16.md
// Value: protects=complete game finals and honest empty alternatives; fails_when=incomplete final closes queue or missing and empty alternatives are conflated; why_new=existing coverage accepts partial finals; seam=none; no_claim=model compliance.
const complete = {
  lat: 1,
  lng: 2,
  facts: 'Дорожный знак',
  conclusion: 'Вероятно север',
  rejected_guesses: [],
};
function handlers(seen: boolean[]): BotSessionHandlers {
  return {
    waitObserveRelease: () => Promise.resolve(),
    executeObserve: () => Promise.resolve({ text: 'view' }),
    executeLook: () => Promise.resolve({ text: 'look' }),
    executeMove: () => Promise.resolve({ text: 'move' }),
    onGuess: (_guess, finalized) => {
      seen.push(finalized);
    },
    onTurnsChanged: () => {},
    getRemainingTimeSec: () => 40,
  };
}

test('advertises a complete final and preserves only valid explicit alternatives', () => {
  expect(finalGuessInputSchema.safeParse(complete).success).toBe(true);
  expect(
    finalGuessInputSchema.safeParse({ ...complete, rejected_guesses: undefined }).success,
  ).toBe(false);
  expect(
    draftGuessInputSchema.safeParse({ ...complete, rejected_guesses: undefined }).success,
  ).toBe(true);
  expect(parseGuessInput(complete)?.rejectedGuesses).toEqual([]);
  expect(
    parseGuessInput({ ...complete, rejected_guesses: [{ guess: 'x' }] })?.rejectedGuesses,
  ).toBeUndefined();
  expect(
    parseGuessInput({
      ...complete,
      rejected_guesses: [{ guess: 'x' }, { guess: 'y', reason: 'z' }],
    })?.rejectedGuesses,
  ).toEqual([{ guess: 'y', reason: 'z' }]);
  const prompt = buildBotRoundPrompt({
    botName: 'Bot',
    regionLabelRu: 'Мир',
    moveEnabled: true,
    moveLimit: 1,
    budgetSec: 60,
    personalityPreset: 'neutral',
    personalityText: '',
    deliveryMode: 'file',
  });
  expect(prompt).toContain('rejected_guesses');
  expect(prompt).toContain('[]');
});

test('game final retains incomplete checkpoint and accepts correction', async () => {
  const seen: boolean[] = [];
  const queue = createBotToolQueue({
    moveLimit: 1,
    moveEnabled: true,
    requireCompleteReasoning: true,
    handlers: handlers(seen),
  });
  const partial = await queue.dispatch('final_guess', { lat: 1, lng: 2, facts: 'Знак' });
  expect(partial.isError).toBe(true);
  expect(partial.text).toContain('facts');
  expect(partial.text).toContain('conclusion');
  expect(partial.text).toContain('rejected_guesses');
  expect(
    (await queue.dispatch('final_guess', { ...complete, rejected_guesses: [{ guess: 'bad' }] }))
      .isError,
  ).toBe(true);
  expect((await queue.dispatch('final_guess', complete)).isError).toBeUndefined();
  expect(seen).toEqual([false, false, true]);
});

test('draft, vision-style default and legacy calls remain compatible', async () => {
  const seen: boolean[] = [];
  const game = createBotToolQueue({
    moveLimit: 0,
    moveEnabled: false,
    requireCompleteReasoning: true,
    handlers: handlers(seen),
  });
  expect(
    (await game.dispatch('draft_guess', { lat: 1, lng: 2, conclusion: 'draft' })).isError,
  ).toBeUndefined();
  expect((await game.dispatch('submit_guess', { lat: 1, lng: 2 })).isError).toBeUndefined();
  const vision = createBotToolQueue({ moveLimit: 0, moveEnabled: false, handlers: handlers(seen) });
  expect(
    (await vision.dispatch('final_guess', { lat: 0, lng: 0, conclusion: '1234' })).isError,
  ).toBeUndefined();
  expect(seen).toEqual([false, true, true]);
});
