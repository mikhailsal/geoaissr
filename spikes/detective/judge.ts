import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { buildSanitizedChildEnv } from '../../server/bots/adapters/shared.ts';
import { spawnManaged } from '../../server/proc/spawn.ts';
import { loadDatasetWithHash, type EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import { runPool } from '../../scripts/eval-bots/pool.ts';
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

const JUDGE_MODEL = 'claude-sonnet-5-5';
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

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('judge reply has no JSON object');
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

async function judgeSpot(
  sample: EvalSampleItem,
  batch: SpotBatch,
  datasetDir: string,
): Promise<{ verdicts: JudgedFinding[]; raw: string; usage: unknown }> {
  const cwd = mkdtempSync(path.join(tmpdir(), 'geo-judge-'));
  try {
    const proc = spawnManaged({
      cmd: [
        'claude',
        '-p',
        buildJudgePrompt(sample, batch),
        '--model',
        JUDGE_MODEL,
        '--tools',
        'Read',
        '--allowedTools',
        'Read',
        '--add-dir',
        datasetDir,
        '--strict-mcp-config',
        '--permission-mode',
        'bypassPermissions',
        '--setting-sources',
        '',
        '--no-session-persistence',
        '--disable-slash-commands',
        '--output-format',
        'json',
      ],
      cwd,
      env: buildSanitizedChildEnv(),
      kind: 'bot',
    });
    const exit = await proc.exited;
    await proc.drained;
    if (exit.code !== 0) throw new Error(`judge exited ${exit.code ?? 'null'}`);
    const out = JSON.parse(proc.getStdout()) as { result?: string; usage?: unknown };
    const raw = out.result ?? '';
    const parsed = verdictSchema.parse(extractJson(raw));
    return { verdicts: parsed.findings, raw, usage: out.usage ?? null };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function argValue(argv: readonly string[], flag: string): string {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (!v) throw new Error(`missing ${flag}`);
  return v;
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
  const verdicts = new Map<string, JudgedFinding[]>();
  const raw: Record<string, unknown> = {};
  const jobs = batches.map((batch) => async () => {
    const sample = samples.get(batch.spotId);
    if (!sample) throw new Error(`unknown spot ${batch.spotId}`);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await judgeSpot(sample, batch, datasetDir);
        verdicts.set(batch.spotId, res.verdicts);
        raw[batch.spotId] = { verdicts: res.verdicts, usage: res.usage };
        console.log(
          `[judge ${batch.spotId}] ${res.verdicts.length}/${batch.items.length} verdicts`,
        );
        return;
      } catch (err) {
        console.error(`[judge ${batch.spotId}] attempt ${attempt}: ${String(err)}`);
      }
    }
  });
  await runPool(jobs, 2, () => false);
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
