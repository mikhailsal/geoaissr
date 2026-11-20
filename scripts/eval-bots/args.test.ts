import { expect, test } from 'bun:test';
import {
  closestFlag,
  evalHelpText,
  EvalArgsError,
  formatEvalArgsError,
  parseEvalArgs,
} from './args.ts';

test('parseEvalArgs applies the documented defaults', () => {
  expect(parseEvalArgs([])).toEqual({
    dry: false,
    help: false,
    spotIds: [],
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
      '--spot',
      'a-1',
      '--spot=b-2',
    ]),
  ).toEqual({
    dry: true,
    help: false,
    spotIds: ['a-1', 'b-2'],
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

test('parseEvalArgs accepts --flag=value as well as --flag value', () => {
  expect(parseEvalArgs(['--repeats=2', '--harness=agy', '--budget', '90'])).toMatchObject({
    repeats: 2,
    harness: 'agy',
    budgetSec: 90,
  });
});

function problem(argv: string[]): string {
  try {
    parseEvalArgs(argv);
  } catch (err) {
    expect(err).toBeInstanceOf(EvalArgsError);
    return formatEvalArgsError(err as EvalArgsError);
  }
  throw new Error(`expected ${argv.join(' ')} to be rejected`);
}

test('unknown flags are rejected with a suggestion and the code', () => {
  const line = problem(['--dyr']);
  expect(line).toContain('unknown flag --dyr');
  expect(line).toContain('did you mean --dry?');
  expect(line.endsWith('(GEO_INVALID_ARGS)')).toBe(true);
  expect(line.includes('\n')).toBe(false);
  expect(problem(['--zzzzzzzzzzzz'])).toContain('see --help');
  expect(problem(['--repeat', '2'])).toContain('--repeats');
  expect(closestFlag('--dataste')).toBe('--dataset');
});

test('duplicate, malformed and stray flags are rejected', () => {
  expect(problem(['--repeats', '1', '--repeats', '2'])).toContain('duplicate flag --repeats');
  expect(problem(['--dry', '--dry'])).toContain('duplicate flag --dry');
  expect(problem(['--spot', 'a', '--spot=a'])).toContain('duplicate flag --spot a');
  expect(problem(['--dry=yes'])).toContain('takes no value');
  expect(problem(['--repeats='])).toContain('non-empty value');
  expect(problem(['--repeats'])).toContain('requires a value');
  expect(problem(['--repeats', '--dry'])).toContain('requires a value');
  expect(problem(['--repeats', '2.5'])).toContain('integer');
  expect(problem(['--spot', 'Bad_Id'])).toContain('malformed spot id');
  expect(problem(['stray'])).toContain('unexpected argument');
  expect(problem(['-d'])).toContain('unexpected argument');
});

test('--help lists every flag with its default', () => {
  expect(parseEvalArgs(['--help']).help).toBe(true);
  const text = evalHelpText();
  for (const flag of ['--dry', '--harness', '--spot', '--repeats', '--budget', '--concurrency']) {
    expect(text).toContain(flag);
  }
  expect(text).toContain('(default: 3)');
  expect(text).toContain('GEO_EVAL_HARNESS_FAILED');
});
