import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getHarnessAdapter } from '../../server/bots/adapters/index.ts';
import type { EvalArgs } from './args.ts';
import { promptHash, toolSchemaHash } from './fingerprint.ts';
import type { EvalSampleItem } from './manifest.ts';
import { summarizeRounds, type EvalSummary, type RunConfig } from './metrics.ts';
import { runPool } from './pool.ts';
import type { RoundRecord } from './records.ts';
import { EVAL_EFFORT, runEvalRound } from './round.ts';

export interface RunControl {
  /** Aborted on Ctrl-C: no new rounds start and running ones are killed. */
  signal: AbortSignal;
  gitCommit: string;
}

export interface RunResult {
  summary: EvalSummary;
  records: RoundRecord[];
  roundsFile: string;
  outDir: string;
  interrupted: boolean;
}

export function buildRunConfig(
  args: EvalArgs,
  opts: {
    spots: number;
    datasetHash: string | null;
    gitCommit: string;
    startedAt: Date;
    interrupted: boolean;
  },
): RunConfig {
  const settings = { harness: args.harness, moveLimit: args.moveLimit, budgetSec: args.budgetSec };
  return {
    label: args.label,
    harness: args.harness,
    model: getHarnessAdapter(args.harness).defaultModel,
    budgetSec: args.budgetSec,
    moveLimit: args.moveLimit,
    imageSize: args.imageSize,
    concurrency: args.concurrency,
    repeats: args.repeats,
    spots: opts.spots,
    dry: args.dry,
    gitCommit: opts.gitCommit,
    date: opts.startedAt.toISOString(),
    effort: EVAL_EFFORT,
    promptHash: promptHash(settings),
    toolSchemaHash: toolSchemaHash(),
    datasetHash: opts.datasetHash,
    plannedRounds: args.repeats * opts.spots,
    interrupted: opts.interrupted,
  };
}

function describe(record: RoundRecord): string {
  if (record.infraError !== null) return `INFRA ERROR: ${record.infraError}`;
  const pin = record.errorKm === null ? 'no pin' : `${record.errorKm} km (${record.pinSource})`;
  return record.error ?? pin;
}

/** Runs every planned round (at most `concurrency` at once) and returns the summary. */
export async function runEval(
  args: EvalArgs,
  samples: readonly EvalSampleItem[],
  datasetHash: string | null,
  repoRoot: string,
  ctl: RunControl,
): Promise<RunResult> {
  const startedAt = new Date();
  const runName = args.label ?? startedAt.toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(
    args.outDir ?? path.join(repoRoot, '.geoaissr-dev', 'evals', runName),
  );
  mkdirSync(outDir, { recursive: true });
  const roundsFile = path.join(outDir, 'rounds.jsonl');
  writeFileSync(roundsFile, '', 'utf8');
  const root = path.join(tmpdir(), `geo-eval-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  let infraSeen = false;
  const jobs: Array<() => Promise<RoundRecord | null>> = [];
  for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
    for (const sample of samples) {
      jobs.push(async () => {
        const record = await runEvalRound({
          root,
          runName,
          settings: args,
          sample,
          repeat,
          signal: ctl.signal,
        });
        if (record === null) return null;
        appendFileSync(roundsFile, `${JSON.stringify(record)}\n`, 'utf8');
        if (record.infraError !== null) infraSeen = true;
        console.log(`[${sample.id} #${repeat}] ${describe(record)}`);
        return record;
      });
    }
  }
  try {
    const results = await runPool(jobs, args.concurrency, () => ctl.signal.aborted || infraSeen);
    const records = results.filter((r): r is RoundRecord => r !== undefined && r !== null);
    const config = buildRunConfig(args, {
      spots: samples.length,
      datasetHash,
      gitCommit: ctl.gitCommit,
      startedAt,
      interrupted: ctl.signal.aborted,
    });
    return {
      summary: summarizeRounds(config, records),
      records,
      roundsFile,
      outDir,
      interrupted: ctl.signal.aborted,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
