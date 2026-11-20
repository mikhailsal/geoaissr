import path from 'node:path';
import {
  evalHelpText,
  EvalArgsError,
  formatEvalArgsError,
  parseEvalArgs,
  type EvalArgs,
} from './eval-bots/args.ts';
import { DatasetError, loadDatasetWithHash } from './eval-bots/manifest.ts';
import { writeRunOutputs } from './eval-bots/output.ts';
import { firstInfraError, formatHarnessFailure } from './eval-bots/report.ts';
import { runEval } from './eval-bots/run.ts';
import { selectSamples } from './eval-bots/select.ts';

const REPO_ROOT = path.resolve(import.meta.dir, '..');

function gitCommit(): string {
  try {
    const res = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT });
    return res.exitCode === 0 ? res.stdout.toString().trim() : 'unknown';
  } catch {
    return 'unknown'; // git is not installed or not on PATH
  }
}

/** Ctrl-C aborts running rounds (their child processes are killed); a second Ctrl-C exits at once. */
function installSigint(controller: AbortController): void {
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    console.error('eval:bots: interrupted; killing running bots and writing a partial summary');
    controller.abort();
  });
}

async function execute(args: EvalArgs): Promise<number> {
  const loaded = loadDatasetWithHash(args.datasetDir);
  const samples = selectSamples(loaded.samples, args);
  const controller = new AbortController();
  installSigint(controller);
  const result = await runEval(args, samples, loaded.datasetHash, REPO_ROOT, {
    signal: controller.signal,
    gitCommit: gitCommit(),
  });
  const out = writeRunOutputs({
    outDir: result.outDir,
    summary: result.summary,
    label: args.label,
    resultsDir: path.join(REPO_ROOT, 'docs', 'evals', 'results'),
  });
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(`Rounds: ${result.roundsFile}`);
  console.log(`Summary: ${out.committedPath ?? out.summaryPath}`);
  if (out.skippedReason !== null) {
    console.error(`eval:bots: --label copy skipped: ${out.skippedReason}`);
  }
  const infra = firstInfraError(result.records);
  if (infra !== null) {
    console.error(formatHarnessFailure(infra, result.summary.infraErrorRounds, result.roundsFile));
    return 1;
  }
  return result.interrupted ? 130 : 0;
}

async function main(): Promise<number> {
  try {
    const args = parseEvalArgs(Bun.argv.slice(2));
    if (args.help) {
      console.log(evalHelpText());
      return 0;
    }
    return await execute(args);
  } catch (err) {
    if (err instanceof EvalArgsError) {
      console.error(formatEvalArgsError(err));
      return 2;
    }
    if (err instanceof DatasetError) {
      console.error(
        `eval:bots: ${err.message}; fix the dataset (rules: docs/evals/README.md) (GEO_INVALID_ARGS)`,
      );
      return 2;
    }
    throw err;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
