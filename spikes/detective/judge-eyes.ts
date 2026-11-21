import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { loadDatasetWithHash, type EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import { wilsonInterval } from '../../scripts/eval-bots/metrics.ts';
import { NONE_OF_THESE } from './choice.ts';
import {
  argValue,
  extractJson,
  judgeEachSpot,
  judgeSettings,
  optionalArg,
  runJudgeCall,
} from './judge-call.ts';
import {
  buildEyesBatches,
  eyesItems,
  isCopiedText,
  type EyesBatch,
  type EyesItem,
} from './judge-eyes-extract.ts';

/**
 * Model judge for the eyes' answers (docs/evals/detective-spike-2.md, bar 3) and, in spike 3,
 * for the eyes' scene report and free descriptions (docs/evals/detective-spike-3.md, bars 3, 4):
 *   bun run spikes/detective/judge-eyes.ts --rounds <rounds.jsonl> --out <dir>
 *     [--judge-model <id>] [--seed <n>] [--resume] [--sheet-only]
 * One `claude -p` call per spot with read-only access to the dataset frames. Writes the sheet
 * (for the owner's human review), the key, the raw verdicts and eyes-judge-summary.json.
 */

const DEFAULT_SEED = 20261122;

export type EyesVerdict = 'correct' | 'wrong' | 'cannot_tell';

const verdictSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().int().min(1),
      verdict: z.enum(['correct', 'wrong', 'cannot_tell']),
      reason: z.string().optional(),
    }),
  ),
});

/** Rules for the statements of spike 3; added only when a batch holds such items. */
const STATEMENT_RULES = [
  '- [scene note] items: one line of a description of the scene, written by an assistant who saw these photos and could zoom into parts of them; a frame number above 4 means such a zoomed view. "correct" if the photos agree with all of it. "wrong" if any part of it is contradicted by the photos or describes something that appears in none of them. Where a note quotes writing from the scene in «…» (a sign, a plate, a label), the quote must reproduce text that appears in the photos, allowing one or two wrong characters per word. A note that says some text cannot be read is "wrong" only if that text is clearly readable.',
  '- [description] items: a request to describe something and the answer in the assistant\'s own words. Judge the answer like a scene note. For "not visible" or "unreadable": "correct" if the thing asked about really cannot be seen or read, "wrong" if it is clearly visible or readable.',
];

export function buildEyesJudgePrompt(sample: EvalSampleItem, batch: EyesBatch): string {
  const frames = (sample.imagePaths ?? []).map((p, i) => `- photo ${i + 1}: ${p}`).join('\n');
  const items = batch.items.map((it) => `${it.n}. ${it.text}`).join('\n');
  const statements = [...batch.key.values()].some(
    (item) => item.kind === 'report' || item.kind === 'describe',
  );
  return [
    'You are checking answers that an assistant gave about one street scene. The questions are in Russian.',
    `First open all four photos of this scene with the Read tool:\n${frames}`,
    'Then judge every numbered item below against the photos only. Small details count as visible if they can be made out in the full-resolution photos.',
    '- [choice] items: a question, its numbered options and the answer. "correct" if the chosen option is the one that fits the photos best; for "none of the options fits", if no option fits; for "not visible" or "unreadable", if the thing asked about really cannot be seen or read. "wrong" if another option fits better, if an option fits though the answer says none does, or if the thing is clearly visible or readable though the answer says it is not.',
    '- [transcription] items: a request to copy visible text and the answer. "correct" if the answer reproduces text that appears in the photos, allowing one or two wrong characters per word; for "not visible" or "unreadable", if no such text can be read. "wrong" if the text is not in the photos, is substantially different, or is clearly readable though the answer says it is not.',
    ...(statements ? STATEMENT_RULES : []),
    '- "cannot_tell" only when the photos do not let you decide, for example a question too vague to check.',
    `Items:\n${items}`,
    'Answer with ONLY a JSON object, no prose: {"items":[{"n":1,"verdict":"correct","reason":"short"}]} with one entry per item number.',
  ].join('\n\n');
}

interface Tally {
  correct: number;
  wrong: number;
  cannotTell: number;
  missing: number;
}

function group(item: EyesItem): string {
  if (item.status === 'abstained') return `${item.kind}Abstained`;
  if (item.kind === 'choice' && item.value === NONE_OF_THESE) return 'choiceNoneOfThese';
  if (item.kind === 'report') return isCopiedText(item) ? 'reportCopiedText' : 'reportLine';
  return `${item.kind}Answered`;
}

const EMPTY: Tally = { correct: 0, wrong: 0, cannotTell: 0, missing: 0 };

function addTallies(tallies: readonly Tally[]): Tally {
  return tallies.reduce(
    (a, b) => ({
      correct: a.correct + b.correct,
      wrong: a.wrong + b.wrong,
      cannotTell: a.cannotTell + b.cannotTell,
      missing: a.missing + b.missing,
    }),
    EMPTY,
  );
}

/** The correct share of the judged items; `cannot_tell` is left out and counted. */
function shareOf(tally: Tally) {
  const judged = tally.correct + tally.wrong;
  return {
    ...tally,
    judged,
    correctRate: judged === 0 ? null : Math.round((tally.correct / judged) * 1000) / 1000,
    ci: wilsonInterval(tally.correct, judged),
  };
}

function barOf(tally: Tally, threshold: number) {
  const share = shareOf(tally);
  return { ...share, barPassed: share.judged > 0 && tally.correct / share.judged >= threshold };
}

function count(t: Tally, verdict: EyesVerdict | undefined): void {
  if (verdict === 'correct') t.correct += 1;
  else if (verdict === 'wrong') t.wrong += 1;
  else if (verdict === 'cannot_tell') t.cannotTell += 1;
  else t.missing += 1;
}

export function summarizeEyesJudgement(
  batches: readonly EyesBatch[],
  verdicts: ReadonlyMap<string, ReadonlyArray<{ n: number; verdict: EyesVerdict }>>,
) {
  const tallies: Record<string, Tally> = {};
  const byConfidence = { sure: { ...EMPTY }, unsure: { ...EMPTY } };
  for (const batch of batches) {
    const byN = new Map((verdicts.get(batch.spotId) ?? []).map((v) => [v.n, v.verdict]));
    for (const [n, item] of batch.key) {
      count((tallies[group(item)] ??= { ...EMPTY }), byN.get(n));
      if (item.status === 'answered' && item.confidence) {
        count(byConfidence[item.confidence], byN.get(n));
      }
    }
  }
  const pick = (...keys: string[]): Tally => addTallies(keys.map((k) => tallies[k] ?? EMPTY));
  return {
    groups: tallies,
    // Spike 3: answered requests by the confidence the eyes gave.
    answersByConfidence: {
      sure: shareOf(byConfidence.sure),
      unsure: shareOf(byConfidence.unsure),
    },
    // Spike 2, bar 3: answered choices, an option or "none of these", over the judged ones.
    choiceAnswered: barOf(pick('choiceAnswered', 'choiceNoneOfThese'), 0.8),
    // Spike 3, bar 3: report lines and answered requests; abstentions are reported apart.
    statements: barOf(
      pick('reportLine', 'reportCopiedText', 'describeAnswered', 'textAnswered'),
      0.8,
    ),
    // Spike 3, bar 4: the texts the eyes copied, in the report or in an answer.
    copiedTexts: barOf(pick('reportCopiedText', 'textAnswered'), 0.9),
  };
}

interface SpotResult {
  verdicts: Array<{ n: number; verdict: EyesVerdict; reason?: string | undefined }>;
  usage: unknown;
}

/** Spots judged by an earlier, interrupted run of the same sheet (`--resume`). */
function loadDone(file: string, resume: boolean): Map<string, SpotResult> {
  if (!resume || !existsSync(file)) return new Map();
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, SpotResult>;
  return new Map(Object.entries(stored));
}

function writeSheets(outDir: string, batches: readonly EyesBatch[]): void {
  const sheet = batches.flatMap((b) => b.items.map((it) => ({ spotId: b.spotId, ...it })));
  const key = batches.flatMap((b) => [...b.key].map(([n, item]) => ({ n, ...item })));
  writeFileSync(path.join(outDir, 'eyes-sheet.json'), `${JSON.stringify(sheet, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'eyes-key.json'), `${JSON.stringify(key, null, 2)}\n`);
}

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);
  const outDir = path.resolve(argValue(argv, '--out'));
  const datasetDir = path.resolve(optionalArg(argv, '--dataset') ?? 'docs/evals/dataset');
  const { model, seed } = judgeSettings(argv, DEFAULT_SEED);
  mkdirSync(outDir, { recursive: true });
  const batches = buildEyesBatches(eyesItems(argValue(argv, '--rounds')), seed);
  writeSheets(outDir, batches);
  if (argv.includes('--sheet-only')) return 0;
  const samples = new Map(loadDatasetWithHash(datasetDir).samples.map((s) => [s.id, s]));
  const byId = new Map(batches.map((b) => [b.spotId, b]));
  const verdictsFile = path.join(outDir, 'eyes-verdicts.json');
  const results = await judgeEachSpot<SpotResult>(
    batches.map((b) => b.spotId),
    async (spotId) => {
      const sample = samples.get(spotId);
      const batch = byId.get(spotId);
      if (!sample || !batch) throw new Error(`unknown spot ${spotId}`);
      const prompt = buildEyesJudgePrompt(sample, batch);
      const { text, usage } = await runJudgeCall(prompt, datasetDir, model);
      return { verdicts: verdictSchema.parse(extractJson(text)).items, usage };
    },
    (spotId, res) => `${res.verdicts.length}/${byId.get(spotId)?.items.length ?? 0} verdicts`,
    loadDone(verdictsFile, argv.includes('--resume')),
  );
  writeFileSync(verdictsFile, `${JSON.stringify(Object.fromEntries(results), null, 2)}\n`);
  const verdicts = new Map([...results].map(([id, res]) => [id, res.verdicts]));
  const summary = {
    judgeModel: model,
    seed,
    spots: batches.length,
    spotsJudged: results.size,
    ...summarizeEyesJudgement(batches, verdicts),
  };
  writeFileSync(
    path.join(outDir, 'eyes-judge-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
  return results.size === batches.length ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
