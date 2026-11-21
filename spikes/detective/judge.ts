import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { loadDatasetWithHash, type EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import { JUDGE_MODEL, argValue, extractJson, judgeEachSpot, runJudgeCall } from './judge-call.ts';
import {
  buildBatches,
  detectiveFindings,
  singleFindings,
  type SpotBatch,
} from './judge-extract.ts';
import { summarizeJudgement, type JudgedFinding } from './judge-stats.ts';

/**
 * Blinded model judge for unsupported findings (docs/evals/detective-spike.md, rubric section).
 *   bun run spikes/detective/judge.ts --detective <rounds.jsonl> --single <rounds.jsonl> --out <dir>
 * One `claude -p` call per spot with read-only access to the dataset frames. Writes the blind
 * sheet (for the owner's human review), the key, the raw verdicts and judge-summary.json.
 */

const SEED = 20261121;

const verdictSchema = z.object({
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

export function buildJudgePrompt(sample: EvalSampleItem, batch: SpotBatch): string {
  const frames = (sample.imagePaths ?? []).map((p, i) => `- frame ${i + 1}: ${p}`).join('\n');
  const findings = batch.items.map((it) => `${it.n}. ${it.text}`).join('\n');
  return [
    'You are auditing notes written by street-view geolocation players. Each note ("finding") describes what the player believes the scene shows and what it implies.',
    `First open all four photos of this scene with the Read tool:\n${frames}`,
    'Then judge every numbered finding below against the photos only:',
    "1. List its visual claims: statements about what is or is not visible in the scene (road markings, driving side, script on signs, sign text, poles, plates, vegetation, soil, roofs, buildings, vehicles...). Claims about countries, places or the writer's reasoning are not visual claims.",
    '2. verdict = "no_visual_claim" if it has none; "unsupported" if at least one visual claim is contradicted by the photos or describes something that appears in none of them; otherwise "supported". Small zoomed details count as visible if they can be seen in the full-resolution photo.',
    '3. rule_ok = true if the geographic rule it states (for example "left-hand traffic narrows it to ...") is correct, false if it is wrong, null if it states none.',
    'Text in […] was masked on purpose; ignore it.',
    `Findings:\n${findings}`,
    'Answer with ONLY a JSON object, no prose: {"findings":[{"n":1,"visual_claims":["..."],"verdict":"supported","rule_ok":true,"reason":"short"}]} with one entry per finding number.',
  ].join('\n\n');
}

async function judgeSpot(
  sample: EvalSampleItem,
  batch: SpotBatch,
  datasetDir: string,
): Promise<{ verdicts: JudgedFinding[]; raw: string; usage: unknown }> {
  const { text, usage } = await runJudgeCall(buildJudgePrompt(sample, batch), datasetDir);
  const parsed = verdictSchema.parse(extractJson(text));
  return { verdicts: parsed.findings, raw: text, usage };
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

async function judgeAll(
  batches: SpotBatch[],
  samples: Map<string, EvalSampleItem>,
  datasetDir: string,
) {
  const byId = new Map(batches.map((b) => [b.spotId, b]));
  const results = await judgeEachSpot(
    batches.map((b) => b.spotId),
    (spotId) => {
      const sample = samples.get(spotId);
      const batch = byId.get(spotId);
      if (!sample || !batch) throw new Error(`unknown spot ${spotId}`);
      return judgeSpot(sample, batch, datasetDir);
    },
    (spotId, res) => `${res.verdicts.length}/${byId.get(spotId)?.items.length ?? 0} verdicts`,
  );
  const verdicts = new Map([...results].map(([id, res]) => [id, res.verdicts]));
  const raw = Object.fromEntries(
    [...results].map(([id, res]) => [id, { verdicts: res.verdicts, usage: res.usage }]),
  );
  return { verdicts, raw };
}

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);
  const outDir = path.resolve(argValue(argv, '--out'));
  const datasetDir = path.resolve(
    argv.includes('--dataset') ? argValue(argv, '--dataset') : 'docs/evals/dataset',
  );
  mkdirSync(outDir, { recursive: true });
  const items = [
    ...detectiveFindings(argValue(argv, '--detective')),
    ...singleFindings(argValue(argv, '--single')),
  ];
  const batches = buildBatches(items, SEED);
  writeSheets(outDir, batches);
  if (argv.includes('--sheet-only')) return 0;
  const samples = new Map(loadDatasetWithHash(datasetDir).samples.map((s) => [s.id, s]));
  const { verdicts, raw } = await judgeAll(batches, samples, datasetDir);
  writeFileSync(path.join(outDir, 'verdicts.json'), `${JSON.stringify(raw, null, 2)}\n`);
  const summary = {
    judgeModel: JUDGE_MODEL,
    seed: SEED,
    spots: batches.length,
    ...summarizeJudgement(batches, verdicts),
  };
  writeFileSync(path.join(outDir, 'judge-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}

if (import.meta.main) process.exit(await main());
