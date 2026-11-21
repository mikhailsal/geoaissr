import type { Arm } from './records.ts';

/** Flags of `bun run spike:detective`. Unknown, duplicate or malformed flags exit 2. */

export interface SpikeArgs {
  arm: Arm;
  budgetSec: number;
  moveLimit: number;
  repeats: number;
  concurrency: number;
  spotIds: string[];
  limit: number | null;
  datasetDir: string | null;
  outDir: string | null;
  label: string | null;
  dry: boolean;
  help: boolean;
}

export class SpikeArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpikeArgsError';
  }
}

export const SPIKE_HELP = `Usage: bun run spike:detective -- [flags]
  --arm detective|labels  detective: brain + eyes; labels: brain fed the human labels (default detective)
  --budget <sec>          round budget, 30-600 (default 90)
  --move-limit <n>        eyes' paid looks, 0-10 (default 4)
  --repeats <n>           passes over the spots, 1-5 (default 1)
  --concurrency <n>       rounds at once, 1-2 (default 1)
  --spot <id>             only this spot (repeatable)
  --limit <n>             first n spots
  --dataset <dir>         dataset folder (default docs/evals/dataset; ignored with --dry)
  --out <dir>             output folder for rounds.jsonl and summary.json
  --label <name>          also write docs/evals/results/detective/<name>.json (aggregate only)
  --dry                   in-process fake roles on built-in spots, no CLI, no cost
  --help                  this text`;

const INT_FLAGS: Record<
  string,
  { key: 'budgetSec' | 'moveLimit' | 'repeats' | 'concurrency' | 'limit'; min: number; max: number }
> = {
  '--budget': { key: 'budgetSec', min: 30, max: 600 },
  '--move-limit': { key: 'moveLimit', min: 0, max: 10 },
  '--repeats': { key: 'repeats', min: 1, max: 5 },
  '--concurrency': { key: 'concurrency', min: 1, max: 2 },
  '--limit': { key: 'limit', min: 1, max: 1000 },
};

const STRING_FLAGS = new Set(['--arm', '--spot', '--dataset', '--out', '--label']);

function parseInt10(flag: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new SpikeArgsError(`${flag} needs an integer (got "${raw}")`);
  const value = Number(raw);
  if (value < min || value > max) throw new SpikeArgsError(`${flag} must be ${min}-${max}`);
  return value;
}

function applyString(out: SpikeArgs, flag: string, value: string): void {
  if (flag === '--spot') out.spotIds.push(value);
  else if (flag === '--dataset') out.datasetDir = value;
  else if (flag === '--out') out.outDir = value;
  else if (flag === '--label') {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value))
      throw new SpikeArgsError('--label must match ^[a-z0-9][a-z0-9-]{0,63}$');
    out.label = value;
  } else if (value === 'detective' || value === 'labels') out.arm = value;
  else throw new SpikeArgsError(`--arm must be detective or labels (got "${value}")`);
}

export function parseSpikeArgs(argv: readonly string[]): SpikeArgs {
  const out: SpikeArgs = {
    arm: 'detective',
    budgetSec: 90,
    moveLimit: 4,
    repeats: 1,
    concurrency: 1,
    spotIds: [],
    limit: null,
    datasetDir: 'docs/evals/dataset',
    outDir: null,
    label: null,
    dry: false,
    help: false,
  };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag === '--dry' || flag === '--help') {
      out[flag === '--dry' ? 'dry' : 'help'] = true;
      continue;
    }
    const intSpec = INT_FLAGS[flag];
    if (!intSpec && !STRING_FLAGS.has(flag)) throw new SpikeArgsError(`unknown flag ${flag}`);
    if (flag !== '--spot' && seen.has(flag)) throw new SpikeArgsError(`duplicate flag ${flag}`);
    seen.add(flag);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--'))
      throw new SpikeArgsError(`${flag} needs a value`);
    i += 1;
    if (intSpec) out[intSpec.key] = parseInt10(flag, value, intSpec.min, intSpec.max);
    else applyString(out, flag, value);
  }
  if (out.dry) out.datasetDir = null;
  return out;
}
