import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getHarnessAdapter } from '../../server/bots/adapters/index.ts';
import { getRegionDiagonalKm } from '../../shared/regions.ts';
import { shortHash } from '../../scripts/eval-bots/fingerprint.ts';
import {
  DatasetError,
  loadDatasetWithHash,
  type EvalSampleItem,
} from '../../scripts/eval-bots/manifest.ts';
import { assertNoAbsolutePaths } from '../../scripts/eval-bots/output.ts';
import { runPool } from '../../scripts/eval-bots/pool.ts';
import { selectSamples } from '../../scripts/eval-bots/select.ts';
import { EvalArgsError } from '../../scripts/eval-bots/args.ts';
import { parseSpikeArgs, SPIKE_HELP, SpikeArgsError, type SpikeArgs } from './args.ts';
import { loadCatalog, type CatalogFeature } from './catalog.ts';
import { summarizeDetective, type DetectiveSummary } from './metrics.ts';
import { buildBrainPrompt, buildEyesPrompt } from './prompts.ts';
import { roleToolDefinitions } from './protocol.ts';
import type { DetectiveRoundRecord } from './records.ts';
import { runDetectiveRound, type DetectiveSettings } from './round.ts';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');
const RESULTS_DIR = path.join(REPO_ROOT, 'docs', 'evals', 'results', 'detective');

function gitCommit(): string {
  const res = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT });
  return res.exitCode === 0 ? res.stdout.toString().trim() : 'unknown';
}

function hashes(args: SpikeArgs, catalog: readonly CatalogFeature[]) {
  const brain = buildBrainPrompt({
    regionLabelRu: 'весь мир',
    regionDiagonalKm: getRegionDiagonalKm('world'),
    budgetSec: args.budgetSec,
    catalog,
  });
  const eyes = args.arm === 'detective' ? buildEyesPrompt({ moveLimit: args.moveLimit }) : '';
  const tools = JSON.stringify([
    roleToolDefinitions('brain', catalog),
    roleToolDefinitions('eyes', catalog),
  ]);
  return { promptHash: shortHash(`${brain}\n---\n${eyes}`), toolSchemaHash: shortHash(tools) };
}

function describe(r: DetectiveRoundRecord): string {
  if (r.infraError) return `INFRA ERROR: ${r.infraError}`;
  const pin = r.errorKm === null ? 'no pin' : `${r.errorKm} km (${r.pinSource})`;
  return `${pin}, ${r.exchanges} exchanges, final ${r.timeToFinalSec ?? '-'} s`;
}

async function runAll(
  args: SpikeArgs,
  samples: EvalSampleItem[],
  catalog: CatalogFeature[],
  roundsFile: string,
  signal: AbortSignal,
) {
  const settings: DetectiveSettings = {
    arm: args.arm,
    budgetSec: args.budgetSec,
    moveLimit: args.moveLimit,
    imageSize: 640,
    model: getHarnessAdapter('claude').defaultModel,
    effort: 'low',
    dry: args.dry,
  };
  const root = mkdtempSync(path.join(tmpdir(), 'geo-detective-'));
  const runName = args.label ?? new Date().toISOString();
  let infraSeen = false;
  const jobs = [];
  for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
    for (const sample of samples) {
      jobs.push(async () => {
        const record = await runDetectiveRound({
          root,
          runName,
          settings,
          sample,
          repeat,
          catalog,
          signal,
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
    const results = await runPool(jobs, args.concurrency, () => signal.aborted || infraSeen);
    return {
      settings,
      records: results.filter((r): r is DetectiveRoundRecord => r !== undefined && r !== null),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeOutputs(outDir: string, summary: DetectiveSummary, label: string | null): void {
  writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (label === null) return;
  if (summary.dry || summary.infraErrorRounds > 0 || !summary.complete) {
    console.error(
      'spike:detective: not copied to docs/evals/results (dry, infra errors or incomplete)',
    );
    return;
  }
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  assertNoAbsolutePaths(text);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, `${label}.json`), text, 'utf8');
}

async function execute(args: SpikeArgs): Promise<number> {
  const loaded = loadDatasetWithHash(args.datasetDir);
  const samples = selectSamples(loaded.samples, args);
  const catalog = loadCatalog();
  const startedAt = new Date();
  const outDir = path.resolve(
    args.outDir ??
      path.join(
        REPO_ROOT,
        '.geoaissr-dev',
        'evals',
        'detective',
        args.label ?? startedAt.toISOString().replace(/[:.]/g, '-'),
      ),
  );
  const roundsFile = path.join(outDir, 'rounds.jsonl');
  if (existsSync(roundsFile))
    throw new SpikeArgsError(`${outDir} already holds a run; pass another --out`);
  if (args.label && existsSync(path.join(RESULTS_DIR, `${args.label}.json`)))
    throw new SpikeArgsError(`result ${args.label} exists; pick another --label`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(roundsFile, '', 'utf8');
  const controller = new AbortController();
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
  });
  const { settings, records } = await runAll(args, samples, catalog, roundsFile, controller.signal);
  const summary = summarizeDetective(
    {
      label: args.label,
      arm: args.arm,
      model: settings.model,
      effort: settings.effort,
      budgetSec: args.budgetSec,
      moveLimit: args.moveLimit,
      imageSize: settings.imageSize,
      concurrency: args.concurrency,
      repeats: args.repeats,
      spots: samples.length,
      spotIds: samples.map((s) => s.id),
      plannedRounds: args.repeats * samples.length,
      dry: args.dry,
      gitCommit: gitCommit(),
      date: startedAt.toISOString(),
      ...hashes(args, catalog),
      datasetHash: loaded.datasetHash,
      interrupted: controller.signal.aborted,
    },
    records,
  );
  writeOutputs(outDir, summary, args.label);
  console.log(`Rounds: ${roundsFile}`);
  if (summary.infraErrorRounds > 0) return 1;
  return controller.signal.aborted ? 130 : 0;
}

async function main(): Promise<number> {
  try {
    const args = parseSpikeArgs(Bun.argv.slice(2));
    if (args.help) {
      console.log(SPIKE_HELP);
      return 0;
    }
    return await execute(args);
  } catch (err) {
    if (
      err instanceof SpikeArgsError ||
      err instanceof EvalArgsError ||
      err instanceof DatasetError
    ) {
      console.error(`spike:detective: ${err.message} (GEO_INVALID_ARGS)`);
      return 2;
    }
    throw err;
  }
}

if (import.meta.main) process.exit(await main());
