import { appendFileSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEvalArgs, type EvalArgs } from './eval-bots/args.ts';
import { loadDataset, type EvalSampleItem } from './eval-bots/manifest.ts';
import { summarizeRounds, type RunConfig } from './eval-bots/metrics.ts';
import type { RoundRecord } from './eval-bots/records.ts';
import { runEvalRound } from './eval-bots/round.ts';

const REPO_ROOT = path.resolve(import.meta.dir, '..');

function gitCommit(): string {
  const res = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT });
  return res.exitCode === 0 ? res.stdout.toString().trim() : 'unknown';
}

function selectSamples(args: EvalArgs): EvalSampleItem[] {
  const samples = loadDataset(args.datasetDir);
  if (!args.dry && samples.some((s) => !s.imagePaths)) {
    throw new Error(
      'Live runs need --dataset with a manifest.json where every spot has 4 imagePaths (use --dry for the built-in fake spots).',
    );
  }
  return args.limit === null ? samples : samples.slice(0, args.limit);
}

/** Runs `jobs` with at most `concurrency` in flight; results keep job order. */
async function runPool<T>(jobs: readonly (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array<T>(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const idx = next;
      next += 1;
      const job = jobs[idx];
      if (job) results[idx] = await job();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

async function main(): Promise<void> {
  const args = parseEvalArgs(Bun.argv.slice(2));
  const samples = selectSamples(args);
  const startedAt = new Date();
  const runName = args.label ?? startedAt.toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(
    args.outDir ?? path.join(REPO_ROOT, '.geoaissr-dev', 'evals', runName),
  );
  mkdirSync(outDir, { recursive: true });
  const roundsFile = path.join(outDir, 'rounds.jsonl');
  writeFileSync(roundsFile, '', 'utf8');
  const root = path.join(tmpdir(), `geo-eval-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const jobs: Array<() => Promise<RoundRecord>> = [];
  for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
    for (const sample of samples) {
      jobs.push(async () => {
        const record = await runEvalRound({ root, settings: args, sample, repeat });
        appendFileSync(roundsFile, `${JSON.stringify(record)}\n`, 'utf8');
        const pin =
          record.errorKm === null ? 'no pin' : `${record.errorKm} km (${record.pinSource})`;
        console.log(`[${sample.id} #${repeat}] ${record.error ?? pin}`);
        return record;
      });
    }
  }
  try {
    const records = await runPool(jobs, args.concurrency);
    const config: RunConfig = {
      label: args.label,
      harness: args.harness,
      model: records[0]?.model ?? 'unknown',
      budgetSec: args.budgetSec,
      moveLimit: args.moveLimit,
      imageSize: args.imageSize,
      concurrency: args.concurrency,
      repeats: args.repeats,
      spots: samples.length,
      dry: args.dry,
      gitCommit: gitCommit(),
      date: startedAt.toISOString(),
    };
    const summary = summarizeRounds(config, records);
    const summaryPath = path.join(outDir, 'summary.json');
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    let reported = summaryPath;
    if (args.label !== null) {
      const resultsDir = path.join(REPO_ROOT, 'docs', 'evals', 'results');
      mkdirSync(resultsDir, { recursive: true });
      reported = path.join(resultsDir, `${args.label}.json`);
      copyFileSync(summaryPath, reported);
    }
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Rounds: ${roundsFile}`);
    console.log(`Summary: ${reported}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main();
}
