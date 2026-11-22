import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argValue, optionalArg } from './judge-call.ts';
import type { DetectiveRoundRecord } from './records.ts';
import { errorBands, textRead } from './report-metrics.ts';

/**
 * Intuition what-ifs of spike 3 (docs/evals/detective-spike-3.md, Part C, "Other reported
 * numbers"). Each Detective round is paired with the single-agent round of the same spot and
 * pass. Under a rule the Detective pin is replaced by the single agent's pin:
 *   (a) when no text was read in the round;
 *   (b) when the brain's confidence is `guess`, or the round has no final guess.
 *   bun run spikes/detective/whatif.ts --detective <rounds.jsonl> --single <rounds.jsonl>
 *     [--out <file>]
 * Nothing is played again: the numbers say what a mixed bot could reach, not what it does.
 */

export interface SingleRow {
  spotId: string;
  repeat: number;
  errorKm: number | null;
  infraError: string | null;
}

type Rule = (round: DetectiveRoundRecord) => boolean;

const RULES: Record<string, Rule> = {
  noTextRead: (r) => !textRead(r),
  confidenceGuess: (r) => r.final === null || (r.final.confidence ?? 'guess') === 'guess',
};

export function whatIfs(detective: readonly DetectiveRoundRecord[], single: readonly SingleRow[]) {
  const singleError = new Map(
    single.filter((r) => r.infraError === null).map((r) => [`${r.spotId}#${r.repeat}`, r.errorKm]),
  );
  const pairs = detective
    .filter((r) => r.infraError === null && singleError.has(`${r.spotId}#${r.repeat}`))
    .map((r) => ({ round: r, single: singleError.get(`${r.spotId}#${r.repeat}`) ?? null }));
  const rules = Object.fromEntries(
    Object.entries(RULES).map(([name, fires]) => [
      name,
      {
        replaced: pairs.filter((p) => fires(p.round)).length,
        ...errorBands(pairs.map((p) => (fires(p.round) ? p.single : p.round.errorKm))),
      },
    ]),
  );
  return {
    pairs: pairs.length,
    asPlayed: errorBands(pairs.map((p) => p.round.errorKm)),
    single: errorBands(pairs.map((p) => p.single)),
    rules,
  };
}

function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function main(): number {
  const argv = Bun.argv.slice(2);
  const report = whatIfs(
    readJsonl<DetectiveRoundRecord>(argValue(argv, '--detective')),
    readJsonl<SingleRow>(argValue(argv, '--single')),
  );
  const text = `${JSON.stringify(report, null, 2)}\n`;
  const out = optionalArg(argv, '--out');
  if (out !== null) writeFileSync(path.resolve(out), text);
  console.log(text);
  return 0;
}

if (import.meta.main) process.exit(main());
