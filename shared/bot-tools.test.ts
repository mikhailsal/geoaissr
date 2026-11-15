import { expect, test } from 'bun:test';
import {
  draftGuessInputSchema,
  finalGuessInputSchema,
  getBotToolDefinitions,
  parseGuessInput,
} from './bot-tools.ts';

// protects=ordered strict tool advertisement and lenient incoming guesses; fails_when=reasoning after coordinates or invalid optional blocks reject coordinates; no_claim=model behavior.
test('advertises evidence before coordinates but accepts partial legacy guesses', () => {
  for (const schema of [draftGuessInputSchema, finalGuessInputSchema]) {
    expect(Object.keys(schema.shape)).toEqual([
      'facts',
      'rejected_guesses',
      'conclusion',
      'lat',
      'lng',
      'quip',
    ]);
    expect(schema.safeParse({ lat: 1, lng: 2 }).success).toBe(false);
  }
  expect(getBotToolDefinitions().map((tool) => tool.name)).toEqual([
    'observe',
    'look',
    'move',
    'draft_guess',
    'final_guess',
    'submit_guess',
  ]);
  expect(
    parseGuessInput({
      lat: 12,
      lng: 190,
      facts: ' road ',
      conclusion: '',
      rejected_guesses: 'bad',
      explanation: ' legacy ',
    }),
  ).toEqual({ lat: 12, lng: -170, explanation: 'legacy', facts: 'road' });
  expect(parseGuessInput({ lat: 91, lng: 0 })).toBeUndefined();
  expect(parseGuessInput({ lat: 0, lng: Infinity })).toBeUndefined();
});
