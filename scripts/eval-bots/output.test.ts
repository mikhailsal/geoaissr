import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RunConfig } from './metrics.ts';
import { summarizeRounds } from './metrics.ts';
import {
  assertNoAbsolutePaths,
  committedResultJson,
  uncommittableReason,
  writeRunOutputs,
} from './output.ts';

const CONFIG: RunConfig = {
  label: 'baseline',
  harness: 'claude',
  model: 'm',
  budgetSec: 60,
  moveLimit: 4,
  imageSize: 640,
  concurrency: 3,
  repeats: 1,
  spots: 1,
  spotIds: ['s1'],
  dry: false,
  gitCommit: 'abc1234',
  date: '2026-01-01T00:00:00.000Z',
  effort: 'low',
  promptHash: 'aaaaaaaaaaaa',
  toolSchemaHash: 'bbbbbbbbbbbb',
  datasetHash: 'cccccccccccc',
  plannedRounds: 0,
  interrupted: false,
};

test('absolute paths and home directories are detected', () => {
  expect(() => {
    assertNoAbsolutePaths('{"a":"/home/someone/x"}', '/home/someone');
  }).toThrow();
  expect(() => {
    assertNoAbsolutePaths('{"a":"/tmp/geo-eval/x"}', '/nowhere');
  }).toThrow();
  expect(() => {
    assertNoAbsolutePaths('{"a":"C:\\\\Users\\\\x"}', '/nowhere');
  }).toThrow();
  expect(() => {
    assertNoAbsolutePaths('{"a":"https://example.org/p","b":"docs/evals/x.json"}', '/nowhere');
  }).not.toThrow();
});

test('the committed result is aggregate-only: no rounds, no absolute paths', () => {
  const text = committedResultJson(summarizeRounds(CONFIG, []));
  const parsed = JSON.parse(text) as Record<string, unknown>;
  expect(parsed.records).toBeUndefined();
  expect(parsed.rounds).toBe(0);
  expect(() => {
    assertNoAbsolutePaths(text);
  }).not.toThrow();
});

test('dry, incomplete and infra-error runs are never committable', () => {
  const dry = summarizeRounds({ ...CONFIG, dry: true }, []);
  expect(dry.dry).toBe(true);
  expect(uncommittableReason(dry)).toContain('dry');
  expect(() => committedResultJson(dry)).toThrow();
  const partial = summarizeRounds({ ...CONFIG, plannedRounds: 3, interrupted: true }, []);
  expect(uncommittableReason(partial)).toContain('incomplete');
});

test('writeRunOutputs writes a partial summary on interrupt and skips the labelled copy', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-out-'));
  try {
    const summary = summarizeRounds({ ...CONFIG, plannedRounds: 6, interrupted: true }, []);
    const out = writeRunOutputs({
      outDir: dir,
      summary,
      label: 'baseline',
      resultsDir: path.join(dir, 'results'),
    });
    const written = JSON.parse(readFileSync(out.summaryPath, 'utf8')) as Record<string, unknown>;
    expect(written).toMatchObject({ complete: false, plannedRounds: 6, completedRounds: 0 });
    expect(out.committedPath).toBeNull();
    expect(out.skippedReason).toContain('incomplete');
    expect(existsSync(path.join(dir, 'results'))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRunOutputs copies a complete labelled run into the results directory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-out-'));
  try {
    const out = writeRunOutputs({
      outDir: dir,
      summary: summarizeRounds(CONFIG, []),
      label: 'baseline',
      resultsDir: path.join(dir, 'results'),
    });
    expect(out.committedPath).toBe(path.join(dir, 'results', 'baseline.json'));
    expect(existsSync(out.committedPath ?? '')).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
