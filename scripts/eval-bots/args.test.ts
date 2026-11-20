import { expect, test } from 'bun:test';
import { parseEvalArgs } from './args.ts';

test('parseEvalArgs applies the documented defaults', () => {
  expect(parseEvalArgs([])).toEqual({
    dry: false,
    harness: 'claude',
    datasetDir: null,
    repeats: 3,
    budgetSec: 60,
    moveLimit: 4,
    imageSize: 640,
    concurrency: 1,
    label: null,
    outDir: null,
    limit: null,
  });
});

test('parseEvalArgs reads every flag', () => {
  expect(
    parseEvalArgs([
      '--dry',
      '--harness',
      'codex',
      '--dataset',
      './ds',
      '--repeats',
      '2',
      '--budget',
      '120',
      '--move-limit',
      '6',
      '--image-size',
      '400',
      '--concurrency',
      '3',
      '--label',
      'baseline-v0.3.0',
      '--out',
      '/tmp/out',
      '--limit',
      '5',
    ]),
  ).toEqual({
    dry: true,
    harness: 'codex',
    datasetDir: './ds',
    repeats: 2,
    budgetSec: 120,
    moveLimit: 6,
    imageSize: 400,
    concurrency: 3,
    label: 'baseline-v0.3.0',
    outDir: '/tmp/out',
    limit: 5,
  });
});

test('parseEvalArgs rejects out-of-range and malformed values', () => {
  const bad = [
    ['--harness', '--dry'],
    ['--harness', 'invalid-cli'],
    ['--repeats', '0'],
    ['--budget', '59'],
    ['--budget', '601'],
    ['--move-limit', '-1'],
    ['--move-limit', '21'],
    ['--image-size', '500'],
    ['--concurrency', '4'],
    ['--concurrency', '0'],
    ['--label', '../escape'],
    ['--limit', '0'],
  ];
  for (const argv of bad) {
    expect(() => parseEvalArgs(argv)).toThrow();
  }
});
