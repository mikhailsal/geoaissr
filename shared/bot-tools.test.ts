import { expect, test } from 'bun:test';
import { finalGuessInputSchema, getBotToolDefinitions, parseGuessInput } from './bot-tools.ts';

test('advertises exactly observe, look, move and final_guess', () => {
  expect(getBotToolDefinitions().map((tool) => tool.name)).toEqual([
    'observe',
    'look',
    'move',
    'final_guess',
  ]);
});

test('look and move advertise finding and current_guess as required', () => {
  for (const name of ['look', 'move']) {
    const tool = getBotToolDefinitions().find((t) => t.name === name);
    const required = tool?.inputSchema.required as string[];
    expect(required).toContain('hypothesis');
    expect(required).toContain('finding');
    expect(required).toContain('current_guess');
  }
});

test('final_guess carries summary and finding, not the old reasoning fields', () => {
  expect(Object.keys(finalGuessInputSchema.shape)).toEqual([
    'summary',
    'finding',
    'shifts',
    'lat',
    'lng',
    'quip',
  ]);
  expect(finalGuessInputSchema.safeParse({ lat: 1, lng: 2 }).success).toBe(false);
});

test('ingress keeps coordinates and bounds the text', () => {
  expect(
    parseGuessInput({ lat: 12, lng: 190, summary: ' я вижу ', finding: ' знак ', shifts: 'bad' }),
  ).toEqual({ lat: 12, lng: -170, explanation: 'я вижу', summary: 'я вижу', finding: 'знак' });
  expect(parseGuessInput({ lat: 91, lng: 0 })).toBeUndefined();
  expect(parseGuessInput({ lat: 0, lng: Infinity })).toBeUndefined();
});

// Value: protects=an over-long summary or finding from a model is truncated, not discarded; fails_when=ingress rejects or drops text past the cap; why_new=replaces the deleted reasoning regression test for facts and conclusion; seam=none; no_claim=whether the kept text is useful.
test('ingress keeps over-long summary and finding text, cut to the cap', () => {
  const parsed = parseGuessInput({
    lat: 1,
    lng: 2,
    summary: 'я'.repeat(700),
    finding: 'з'.repeat(700),
  });
  expect(parsed?.summary).toHaveLength(600);
  expect(parsed?.finding).toHaveLength(600);
});
