import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDatasetWithHash, type EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import { EFFORT_LEVELS, type EffortLevel } from '../../shared/bot-tools.ts';
import { getRegionDiagonalKm } from '../../shared/regions.ts';
import { haversineDistanceKm } from '../../shared/score.ts';
import {
  buildCeilingBrainPrompt,
  buildDescriberPrompt,
  parseDescriberReply,
  parseGuessReply,
  type CeilingGuess,
} from './ceiling-prompts.ts';
import {
  ceilingDecision,
  summarizeCeiling,
  type CeilingRow,
  type Share,
} from './ceiling-summary.ts';
import { pairedBySpot, type ErrorRow } from './compare.ts';
import { createPlaceGuard, type PlaceGuard } from './guard.ts';
import { argValue, optionalArg } from './judge-call.ts';
import { runKeyedJobs, runModelCall } from './model-call.ts';
import { emptyReport, formatReport, maskReport, reportLines, type SceneReport } from './report.ts';

/**
 * Ceiling test of spike 3 (docs/evals/detective-spike-3.md, Part B): a describer writes a full
 * scene report with no time limit, and a brain with no picture and no tools places the spot.
 *   bun run spikes/detective/ceiling.ts describe --model <id> --out <dir>
 *     [--effort medium] [--limit <n>] [--concurrency 2] [--resume] [--dry]
 *   bun run spikes/detective/ceiling.ts guess --reports <dir> --out <dir>
 *     [--brain-model <id>] [--effort medium] [--passes 3] [--concurrency 4] [--resume] [--dry]
 *   bun run spikes/detective/ceiling.ts summary --haiku <dir> --sonnet <dir> [--low <dir>]
 *     --detective <rounds.jsonl> --single <rounds.jsonl> [--out <file>]
 * Every result is appended as it arrives, so an interrupted run continues with `--resume`.
 */

const DEFAULT_BRAIN_MODEL = 'claude-sonnet-5-5';

export interface ReportRow {
  spotId: string;
  describer: string;
  effort: EffortLevel;
  report: SceneReport;
  usage: unknown;
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

/** A result file is never overwritten: a second run must say `--resume`. */
function openResults<T>(file: string, resume: boolean, keyOf: (row: T) => string): Map<string, T> {
  if (existsSync(file) && !resume) throw new Error(`${file} exists; pass --resume to continue it`);
  mkdirSync(path.dirname(file), { recursive: true });
  return new Map(readJsonl<T>(file).map((row) => [keyOf(row), row]));
}

interface CommonOptions {
  datasetDir: string;
  effort: EffortLevel;
  resume: boolean;
  dry: boolean;
  concurrency: number;
}

export interface DescribeOptions extends CommonOptions {
  model: string;
  outDir: string;
  limit: number | null;
}

/** A report made from the spot's labels at no cost, for `--dry` and the tests. */
function dryReport(sample: EvalSampleItem): SceneReport {
  const report = emptyReport();
  for (const sign of sample.signText ?? []) {
    report.sections.texts.push({ text: `«${sign.text}» — надпись`, frame: sign.frame + 1 });
  }
  const side = sample.labels?.['driving_side'];
  if (side) report.sections.road.push({ text: `сторона движения: ${side}`, frame: 1 });
  return report;
}

export async function runDescribe(opts: DescribeOptions): Promise<number> {
  const all = loadDatasetWithHash(opts.datasetDir).samples;
  const samples = opts.limit === null ? all : all.slice(0, opts.limit);
  const byId = new Map(samples.map((s) => [s.id, s]));
  const file = path.join(opts.outDir, 'reports.jsonl');
  const results = await runKeyedJobs<ReportRow>({
    keys: samples.map((s) => s.id),
    label: 'describe',
    done: openResults<ReportRow>(file, opts.resume, (row) => row.spotId),
    concurrency: opts.concurrency,
    run: async (spotId) => {
      const sample = byId.get(spotId);
      if (!sample) throw new Error(`unknown spot ${spotId}`);
      const base = { spotId, describer: opts.model, effort: opts.effort };
      if (opts.dry) return { ...base, report: dryReport(sample), usage: null };
      const { text, usage } = await runModelCall({
        prompt: buildDescriberPrompt(sample),
        model: opts.model,
        readDir: opts.datasetDir,
        effort: opts.effort,
      });
      return { ...base, report: parseDescriberReply(text), usage };
    },
    describe: (_spotId, row) => `${reportLines(row.report).length} lines`,
    onResult: (_spotId, row) => {
      appendFileSync(file, `${JSON.stringify(row)}\n`);
    },
  });
  return samples.every((s) => results.has(s.id)) ? 0 : 1;
}

export interface GuessOptions extends CommonOptions {
  reportsDir: string;
  outDir: string;
  brainModel: string;
  passes: number;
}

interface GuessContext {
  opts: GuessOptions;
  guard: PlaceGuard;
  reports: Map<string, ReportRow>;
  samples: Map<string, EvalSampleItem>;
}

async function askBrain(
  prompt: string,
  sample: EvalSampleItem,
  opts: GuessOptions,
): Promise<{ guess: CeilingGuess; usage: unknown }> {
  if (opts.dry) {
    const guess: CeilingGuess = {
      lat: sample.lat + 0.5,
      lng: sample.lng + 0.5,
      confidence: 'country',
      clue: 'сухой прогон',
    };
    return { guess, usage: null };
  }
  const { text, usage } = await runModelCall({
    prompt,
    model: opts.brainModel,
    readDir: null,
    effort: opts.effort,
  });
  return { guess: parseGuessReply(text), usage };
}

async function guessOnce(key: string, ctx: GuessContext): Promise<CeilingRow> {
  const [spotId = '', repeatText = ''] = key.split('#');
  const row = ctx.reports.get(spotId);
  const sample = ctx.samples.get(spotId);
  if (!row || !sample) throw new Error(`unknown spot ${spotId}`);
  const { report, masked } = maskReport(ctx.guard, row.report);
  const prompt = buildCeilingBrainPrompt({
    regionLabelRu: 'весь мир',
    regionDiagonalKm: getRegionDiagonalKm('world'),
    reportText: formatReport(report),
  });
  const { guess, usage } = await askBrain(prompt, sample, ctx.opts);
  const pin = { lat: guess.lat, lng: guess.lng };
  return {
    spotId,
    repeat: Number(repeatText),
    describer: row.describer,
    brainModel: ctx.opts.brainModel,
    effort: ctx.opts.effort,
    pin,
    confidence: guess.confidence,
    clue: guess.clue,
    errorKm: Math.round(haversineDistanceKm(pin, { lat: sample.lat, lng: sample.lng }) * 10) / 10,
    infraError: null,
    maskedWords: masked,
    usage,
  };
}

export async function runGuess(opts: GuessOptions): Promise<number> {
  const reports = readJsonl<ReportRow>(path.join(opts.reportsDir, 'reports.jsonl'));
  if (reports.length === 0) throw new Error(`no reports in ${opts.reportsDir}`);
  const ctx: GuessContext = {
    opts,
    guard: createPlaceGuard(),
    reports: new Map(reports.map((r) => [r.spotId, r])),
    samples: new Map(loadDatasetWithHash(opts.datasetDir).samples.map((s) => [s.id, s])),
  };
  const file = path.join(opts.outDir, 'rounds.jsonl');
  const keys = reports.flatMap((r) =>
    Array.from({ length: opts.passes }, (_v, i) => `${r.spotId}#${i + 1}`),
  );
  const results = await runKeyedJobs<CeilingRow>({
    keys,
    label: 'guess',
    done: openResults<CeilingRow>(file, opts.resume, (row) => `${row.spotId}#${row.repeat}`),
    concurrency: opts.concurrency,
    run: (key) => guessOnce(key, ctx),
    describe: (_key, row) => `${row.errorKm} km, ${row.confidence}`,
    onResult: (_key, row) => {
      appendFileSync(file, `${JSON.stringify(row)}\n`);
    },
  });
  return keys.every((key) => results.has(key)) ? 0 : 1;
}

const within750 = (rows: readonly CeilingRow[]): Share => ({
  hits: rows.filter((r) => r.errorKm <= 750).length,
  total: rows.length,
});

function maskedCounts(rows: readonly CeilingRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  // The masked words are a property of the report, so one pass per spot is counted.
  for (const row of rows.filter((r) => r.repeat === 1)) {
    for (const word of row.maskedWords) counts[word] = (counts[word] ?? 0) + 1;
  }
  return counts;
}

export interface CeilingReportInput {
  haikuDir: string;
  sonnetDir: string;
  /** The low-effort brain on the better describer's reports; null until it has run. */
  lowDir: string | null;
  detectiveRounds: string;
  singleRounds: string;
}

export function ceilingReport(input: CeilingReportInput) {
  const rowsOf = (dir: string): CeilingRow[] =>
    readJsonl<CeilingRow>(path.join(dir, 'rounds.jsonl'));
  const detective = readJsonl<ErrorRow>(input.detectiveRounds);
  const single = readJsonl<ErrorRow>(input.singleRounds);
  const arm = (rows: readonly CeilingRow[]) => ({
    describer: rows[0]?.describer ?? null,
    brainModel: rows[0]?.brainModel ?? null,
    effort: rows[0]?.effort ?? null,
    ...summarizeCeiling(rows),
    maskedWords: maskedCounts(rows),
    againstDetective2: pairedBySpot(rows, detective),
    againstSingle: pairedBySpot(rows, single),
  });
  const haiku = rowsOf(input.haikuDir);
  const sonnet = rowsOf(input.sonnetDir);
  const low = input.lowDir === null ? null : rowsOf(input.lowDir);
  return {
    arms: {
      haikuMedium: arm(haiku),
      sonnetMedium: arm(sonnet),
      ...(low === null ? {} : { betterLow: arm(low) }),
    },
    decision: ceilingDecision(
      { haiku: within750(haiku), sonnet: within750(sonnet) },
      low === null ? null : within750(low),
    ),
  };
}

function effortArg(argv: readonly string[]): EffortLevel {
  const value = optionalArg(argv, '--effort') ?? 'medium';
  const effort = EFFORT_LEVELS.find((level) => level === value);
  if (!effort) throw new Error(`bad --effort ${value}`);
  return effort;
}

function intArg(argv: readonly string[], flag: string, fallback: number): number {
  const text = optionalArg(argv, flag);
  const value = text === null ? fallback : Number(text);
  if (!Number.isInteger(value) || value < 1) throw new Error(`bad ${flag} ${text ?? ''}`);
  return value;
}

async function main(): Promise<number> {
  const [phase, ...argv] = Bun.argv.slice(2);
  const dir = (flag: string): string => path.resolve(argValue(argv, flag));
  const common = {
    datasetDir: path.resolve(optionalArg(argv, '--dataset') ?? 'docs/evals/dataset'),
    effort: effortArg(argv),
    resume: argv.includes('--resume'),
    dry: argv.includes('--dry'),
  };
  if (phase === 'describe') {
    return runDescribe({
      ...common,
      model: argValue(argv, '--model'),
      outDir: dir('--out'),
      limit: argv.includes('--limit') ? intArg(argv, '--limit', 1) : null,
      concurrency: intArg(argv, '--concurrency', 2),
    });
  }
  if (phase === 'guess') {
    return runGuess({
      ...common,
      reportsDir: dir('--reports'),
      outDir: dir('--out'),
      brainModel: optionalArg(argv, '--brain-model') ?? DEFAULT_BRAIN_MODEL,
      passes: intArg(argv, '--passes', 3),
      concurrency: intArg(argv, '--concurrency', 4),
    });
  }
  if (phase !== 'summary') {
    console.error('usage: ceiling.ts describe|guess|summary ... (see the file header)');
    return 2;
  }
  const report = ceilingReport({
    haikuDir: dir('--haiku'),
    sonnetDir: dir('--sonnet'),
    lowDir: argv.includes('--low') ? dir('--low') : null,
    detectiveRounds: dir('--detective'),
    singleRounds: dir('--single'),
  });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  const out = optionalArg(argv, '--out');
  if (out !== null) writeFileSync(path.resolve(out), text);
  console.log(text);
  return 0;
}

if (import.meta.main) process.exit(await main());
