import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { EvalSummary } from './metrics.ts';

const ABSOLUTE_PATH = /(?<![\w.:/-])\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|[A-Za-z]:\\/;

/** Throws when serialized text holds an absolute filesystem path or the home directory. */
export function assertNoAbsolutePaths(text: string, home: string = homedir()): void {
  if ((home.length > 1 && text.includes(home)) || ABSOLUTE_PATH.test(text)) {
    throw new Error('Result JSON contains an absolute path; refusing to commit it');
  }
}

/** Why a summary must not be published as a measured result, or null when it may be. */
export function uncommittableReason(summary: EvalSummary): string | null {
  if (summary.dry) return 'dry runs are never copied as measured results';
  if (summary.infraErrorRounds > 0) return 'the run had harness (infra) errors';
  if (!summary.complete) return 'the run is incomplete';
  return null;
}

/** Aggregate-only JSON for docs/evals/results: the summary itself, no rounds, no paths. */
export function committedResultJson(summary: EvalSummary, home?: string): string {
  const reason = uncommittableReason(summary);
  if (reason !== null) throw new Error(`Not a committable result: ${reason}`);
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  assertNoAbsolutePaths(text, home);
  return text;
}

export interface WrittenOutputs {
  summaryPath: string;
  /** Path of the committed copy, or null when none was written. */
  committedPath: string | null;
  /** Why no committed copy was written (only when a label was given). */
  skippedReason: string | null;
}

/** Writes summary.json (also for partial runs) and, with a label, the committed aggregate copy. */
export function writeRunOutputs(opts: {
  outDir: string;
  summary: EvalSummary;
  label: string | null;
  resultsDir: string;
}): WrittenOutputs {
  const summaryPath = path.join(opts.outDir, 'summary.json');
  writeFileSync(summaryPath, `${JSON.stringify(opts.summary, null, 2)}\n`, 'utf8');
  if (opts.label === null) return { summaryPath, committedPath: null, skippedReason: null };
  const reason = uncommittableReason(opts.summary);
  if (reason !== null) return { summaryPath, committedPath: null, skippedReason: reason };
  mkdirSync(opts.resultsDir, { recursive: true });
  const committedPath = path.join(opts.resultsDir, `${opts.label}.json`);
  writeFileSync(committedPath, committedResultJson(opts.summary), 'utf8');
  return { summaryPath, committedPath, skippedReason: null };
}
