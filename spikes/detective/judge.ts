import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { loadDatasetWithHash, type EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import {
  argValue,
  extractJson,
  judgeEachSpot,
  judgeSettings,
  optionalArg,
  runJudgeCall,
} from './judge-call.ts';
import {
  buildBatches,
  detectiveFindings,
  singleFindings,
  type SpotBatch,
} from './judge-extract.ts';
import { summarizeJudgement, verdictFromClaims, type JudgedFinding } from './judge-stats.ts';

/**
 * Blinded model judge for unsupported findings (docs/evals/detective-spike.md, rubric section;
 * rubric v2 in docs/evals/detective-spike-3.md, Part A).
 *   bun run spikes/detective/judge.ts --detective <rounds.jsonl> --single <rounds.jsonl> --out <dir>
 *     [--rubric v1|v2] [--judge-model <id>] [--seed <n>] [--resume] [--sheet-only]
 * One `claude -p` call per spot with read-only access to the dataset frames. Writes the blind
 * sheet (for the owner's human review), the key, the raw verdicts and judge-summary.json.
 */

const DEFAULT_SEED = 20261121;

export type Rubric = 'v1' | 'v2';

type StoredFinding = JudgedFinding & { reason?: string };

const v1Schema = z.object({
  findings: z.array(
    z.object({
      n: z.number().int().min(1),
      visual_claims: z.array(z.string()).optional(),
      verdict: z.enum(['supported', 'unsupported', 'no_visual_claim']),
      rule_ok: z.boolean().nullable(),
      reason: z.string().optional(),
    }),
  ),
});

const v2Schema = z.object({
  findings: z.array(
    z.object({
      n: z.number().int().min(1),
      claims: z.array(
        z.object({
          text: z.string(),
          mark: z.enum(['ok', 'contradicted', 'absent', 'unclear']),
        }),
      ),
      rule_ok: z.boolean().nullable(),
      reason: z.string().optional(),
    }),
  ),
});

const CLAIMS_RULE =
  "1. List its visual claims: statements about what is or is not visible in the scene (road markings, driving side, script on signs, sign text, poles, plates, vegetation, soil, roofs, buildings, vehicles...). Claims about countries, places or the writer's reasoning are not visual claims.";
const RULE_OK =
  '3. rule_ok = true if the geographic rule it states (for example "left-hand traffic narrows it to ...") is correct, false if it is wrong, null if it states none.';

const RUBRIC_TEXT: Record<Rubric, { marks: string; answer: string }> = {
  v1: {
    marks:
      '2. verdict = "no_visual_claim" if it has none; "unsupported" if at least one visual claim is contradicted by the photos or describes something that appears in none of them; otherwise "supported". Small zoomed details count as visible if they can be seen in the full-resolution photo.',
    answer:
      'Answer with ONLY a JSON object, no prose: {"findings":[{"n":1,"visual_claims":["..."],"verdict":"supported","rule_ok":true,"reason":"short"}]} with one entry per finding number.',
  },
  v2: {
    marks:
      '2. Mark each claim: "ok" if the photos agree with it; "contradicted" if the photos show otherwise, including a claimed absence of something that is plainly there; "absent" if it describes something that appears in none of the photos; "unclear" if the photos are too small, dark or blurred to settle it either way. Small zoomed details count as visible if they can be seen in the full-resolution photo. Do not mark a plainly right or plainly wrong claim "unclear".',
    answer:
      'Answer with ONLY a JSON object, no prose: {"findings":[{"n":1,"claims":[{"text":"...","mark":"ok"}],"rule_ok":true,"reason":"short"}]} with one entry per finding number. A finding with no visual claim gets "claims":[].',
  },
};

export function buildJudgePrompt(
  sample: EvalSampleItem,
  batch: SpotBatch,
  rubric: Rubric = 'v1',
): string {
  const frames = (sample.imagePaths ?? []).map((p, i) => `- frame ${i + 1}: ${p}`).join('\n');
  const findings = batch.items.map((it) => `${it.n}. ${it.text}`).join('\n');
  return [
    'You are auditing notes written by street-view geolocation players. Each note ("finding") describes what the player believes the scene shows and what it implies.',
    `First open all four photos of this scene with the Read tool:\n${frames}`,
    'Then judge every numbered finding below against the photos only:',
    CLAIMS_RULE,
    RUBRIC_TEXT[rubric].marks,
    RULE_OK,
    'Text in […] was masked on purpose; ignore it.',
    `Findings:\n${findings}`,
    RUBRIC_TEXT[rubric].answer,
  ].join('\n\n');
}

/** Parses a judge reply. Under rubric v2 the verdict is derived from the claim marks. */
export function parseJudgeReply(text: string, rubric: Rubric): StoredFinding[] {
  const json = extractJson(text);
  if (rubric === 'v1') return v1Schema.parse(json).findings;
  return v2Schema.parse(json).findings.map((f) => ({
    n: f.n,
    verdict: verdictFromClaims(f.claims),
    rule_ok: f.rule_ok,
    claims: f.claims,
    ...(f.reason === undefined ? {} : { reason: f.reason }),
  }));
}

interface JudgeRun {
  rubric: Rubric;
  model: string;
  datasetDir: string;
}

interface SpotResult {
  verdicts: StoredFinding[];
  usage: unknown;
}

async function judgeSpot(
  sample: EvalSampleItem,
  batch: SpotBatch,
  run: JudgeRun,
): Promise<SpotResult> {
  const prompt = buildJudgePrompt(sample, batch, run.rubric);
  const { text, usage } = await runJudgeCall(prompt, run.datasetDir, run.model);
  return { verdicts: parseJudgeReply(text, run.rubric), usage };
}

function writeSheets(outDir: string, batches: readonly SpotBatch[]): void {
  const sheet = batches.flatMap((b) => b.items.map((it) => ({ spotId: b.spotId, ...it })));
  const key = batches.flatMap((b) =>
    [...b.key].map(([n, item]) => ({
      spotId: b.spotId,
      n,
      arm: item.arm,
      executionId: item.executionId,
    })),
  );
  writeFileSync(path.join(outDir, 'blind-sheet.json'), `${JSON.stringify(sheet, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'blind-key.json'), `${JSON.stringify(key, null, 2)}\n`);
}

/** Spots judged by an earlier, interrupted run of the same sheet (`--resume`). */
function loadDone(file: string, resume: boolean): Map<string, SpotResult> {
  if (!resume || !existsSync(file)) return new Map();
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, SpotResult>;
  return new Map(Object.entries(stored));
}

async function judgeAll(
  batches: SpotBatch[],
  samples: Map<string, EvalSampleItem>,
  run: JudgeRun,
  done: ReadonlyMap<string, SpotResult>,
): Promise<Map<string, SpotResult>> {
  const byId = new Map(batches.map((b) => [b.spotId, b]));
  return judgeEachSpot(
    batches.map((b) => b.spotId),
    (spotId) => {
      const sample = samples.get(spotId);
      const batch = byId.get(spotId);
      if (!sample || !batch) throw new Error(`unknown spot ${spotId}`);
      return judgeSpot(sample, batch, run);
    },
    (spotId, res) => `${res.verdicts.length}/${byId.get(spotId)?.items.length ?? 0} verdicts`,
    done,
  );
}

function rubricArg(argv: readonly string[]): Rubric {
  const value = optionalArg(argv, '--rubric') ?? 'v1';
  if (value !== 'v1' && value !== 'v2') throw new Error(`bad --rubric ${value}`);
  return value;
}

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);
  const outDir = path.resolve(argValue(argv, '--out'));
  const datasetDir = path.resolve(optionalArg(argv, '--dataset') ?? 'docs/evals/dataset');
  const { model, seed } = judgeSettings(argv, DEFAULT_SEED);
  const rubric = rubricArg(argv);
  mkdirSync(outDir, { recursive: true });
  const items = [
    ...detectiveFindings(argValue(argv, '--detective')),
    ...singleFindings(argValue(argv, '--single')),
  ];
  const batches = buildBatches(items, seed);
  writeSheets(outDir, batches);
  if (argv.includes('--sheet-only')) return 0;
  const samples = new Map(loadDatasetWithHash(datasetDir).samples.map((s) => [s.id, s]));
  const verdictsFile = path.join(outDir, 'verdicts.json');
  const done = loadDone(verdictsFile, argv.includes('--resume'));
  const results = await judgeAll(batches, samples, { rubric, model, datasetDir }, done);
  writeFileSync(verdictsFile, `${JSON.stringify(Object.fromEntries(results), null, 2)}\n`);
  const verdicts = new Map([...results].map(([id, res]) => [id, res.verdicts]));
  const summary = {
    judgeModel: model,
    seed,
    rubric,
    spots: batches.length,
    spotsJudged: results.size,
    ...summarizeJudgement(batches, verdicts),
  };
  writeFileSync(path.join(outDir, 'judge-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  return results.size === batches.length ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
