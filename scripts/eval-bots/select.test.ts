import { expect, test } from 'bun:test';
import { EvalArgsError } from './args.ts';
import { loadDataset } from './manifest.ts';
import { selectSamples } from './select.ts';

const SAMPLES = loadDataset(null);
const base = { spotIds: [] as string[], limit: null, dry: true };

test('--spot selects spots by manifest id and keeps manifest order', () => {
  expect(selectSamples(SAMPLES, base)).toHaveLength(3);
  const picked = selectSamples(SAMPLES, { ...base, spotIds: ['sample-milan', 'sample-warsaw'] });
  expect(picked.map((s) => s.id)).toEqual(['sample-warsaw', 'sample-milan']);
  expect(selectSamples(SAMPLES, { ...base, limit: 2 })).toHaveLength(2);
});

test('an unknown spot id is a GEO_INVALID_ARGS problem', () => {
  expect(() => selectSamples(SAMPLES, { ...base, spotIds: ['nope'] })).toThrow(EvalArgsError);
});

test('live runs reject spots without frames', () => {
  expect(() => selectSamples(SAMPLES, { ...base, dry: false })).toThrow(EvalArgsError);
});
