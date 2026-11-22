import { expect, test } from 'bun:test';
import {
  clampMoveDistanceM,
  finalGuessInputSchema,
  getBotToolDefinitions,
  MOVE_DISTANCE_MAX_M,
  MOVE_DISTANCE_MIN_M,
  parseGuessInput,
} from './bot-tools.ts';

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

// Value: protects=the long move is advertised to the bot as an optional distance with its range; fails_when=distance_m becomes required, loses its range, or disappears from the move tool; seam=none; no_claim=whether a model uses it.
test('move advertises an optional distance_m with its range', () => {
  const move = getBotToolDefinitions().find((t) => t.name === 'move');
  const props = move?.inputSchema.properties as Record<string, Record<string, unknown>>;
  expect(props.distance_m).toMatchObject({
    type: 'number',
    minimum: MOVE_DISTANCE_MIN_M,
    maximum: MOVE_DISTANCE_MAX_M,
  });
  expect(move?.inputSchema.required as string[]).not.toContain('distance_m');
  expect(move?.description).toContain('distance_m');
  // With movement off the tool says so and does not describe a long move.
  const off = getBotToolDefinitions(false).find((t) => t.name === 'move');
  expect(off?.description).not.toContain('distance_m');
  expect(clampMoveDistanceM(5)).toBe(MOVE_DISTANCE_MIN_M);
  expect(clampMoveDistanceM(1e9)).toBe(MOVE_DISTANCE_MAX_M);
  expect(clampMoveDistanceM(432.6)).toBe(433);
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
