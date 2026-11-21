import { expect, test } from 'bun:test';
import { parseSpikeArgs, SpikeArgsError } from './args.ts';
import { scoreItem, transcriptionMatches } from './scoring.ts';
import { SAMPLE } from './test-helpers.ts';

test('feature answers are scored against the label; abstentions are not scored', () => {
  const q = { kind: 'feature', feature: 'driving_side' } as const;
  const hit = scoreItem(SAMPLE, { n: 1, question: q, status: 'answered', value: 'left', frame: 1 });
  expect(hit.agrees).toBe(true);
  const miss = scoreItem(SAMPLE, {
    n: 1,
    question: q,
    status: 'answered',
    value: 'right',
    frame: 1,
  });
  expect(miss.agrees).toBe(false);
  const roof = { kind: 'feature', feature: 'roof_type' } as const;
  const abstain = scoreItem(SAMPLE, {
    n: 1,
    question: roof,
    status: 'abstained',
    value: 'not_visible',
    frame: null,
  });
  expect(abstain.agrees).toBeNull();
  expect(abstain.label).toBe('not_visible');
});

test('transcriptions match by containment or a shared word, and invented places are counted', () => {
  expect(transcriptionMatches('LAWSON', ['ローソン LAWSON'])).toBe(true);
  expect(transcriptionMatches('lawson store', ['LAWSON'])).toBe(true);
  expect(transcriptionMatches('7-ELEVEN', ['ローソン LAWSON'])).toBe(false);
  expect(transcriptionMatches('?', ['LAWSON'])).toBe(false);
  const q = { kind: 'text', target: 'вывеска' } as const;
  const item = scoreItem(SAMPLE, {
    n: 1,
    question: q,
    status: 'answered',
    value: 'LAWSON TOKYO',
    frame: 2,
  });
  expect(item.agrees).toBe(true);
  expect(item.inventedPlaces).toEqual(['tokyo']);
});

test('spike flags are strict', () => {
  const args = parseSpikeArgs(['--arm', 'labels', '--budget', '60', '--spot', 'a', '--spot', 'b']);
  expect(args.arm).toBe('labels');
  expect(args.budgetSec).toBe(60);
  expect(args.spotIds).toEqual(['a', 'b']);
  expect(() => parseSpikeArgs(['--concurrency', '3'])).toThrow(SpikeArgsError);
  expect(() => parseSpikeArgs(['--budget', '60', '--budget', '90'])).toThrow('duplicate');
  expect(() => parseSpikeArgs(['--bogus'])).toThrow('unknown flag');
  expect(() => parseSpikeArgs(['--arm', 'solo'])).toThrow('--arm');
  expect(parseSpikeArgs(['--dry']).datasetDir).toBeNull();
});
