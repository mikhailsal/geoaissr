import { HARNESS_IDS, type HarnessId } from '../../shared/storage-schemas.ts';
import { SPOT_ID_PATTERN } from './manifest.ts';

export type EvalImageSize = 256 | 400 | 640;

export interface EvalArgs {
  dry: boolean;
  help: boolean;
  harness: HarnessId;
  datasetDir: string | null;
  /** Manifest ids selected with `--spot`; empty means every spot. */
  spotIds: string[];
  repeats: number;
  budgetSec: number;
  moveLimit: number;
  imageSize: EvalImageSize;
  concurrency: number;
  label: string | null;
  outDir: string | null;
  /** Number of spots to use (first N after `--spot` selection); null means all. */
  limit: number | null;
}

/** A command-line problem; the CLI prints it as one line with the code GEO_INVALID_ARGS. */
export class EvalArgsError extends Error {
  readonly suggestion: string | null;
  constructor(message: string, suggestion: string | null = null) {
    super(message);
    this.name = 'EvalArgsError';
    this.suggestion = suggestion;
  }
}

type FlagKind = 'bool' | 'value' | 'repeatable';

interface FlagSpec {
  name: string;
  kind: FlagKind;
  fallback: string;
  help: string;
}

/** Single source of truth for the accepted flags: parsing, suggestions and `--help` use it. */
export const FLAG_SPECS: readonly FlagSpec[] = [
  { name: '--help', kind: 'bool', fallback: 'off', help: 'print this help and exit 0' },
  {
    name: '--dry',
    kind: 'bool',
    fallback: 'off',
    help: 'fake bots, no CLI launched, never committed',
  },
  { name: '--harness', kind: 'value', fallback: 'claude', help: HARNESS_IDS.join(' | ') },
  {
    name: '--dataset',
    kind: 'value',
    fallback: 'built-in fake spots (--dry)',
    help: 'directory with manifest.json',
  },
  {
    name: '--spot',
    kind: 'repeatable',
    fallback: 'all spots',
    help: 'manifest spot id; repeat to select several',
  },
  { name: '--repeats', kind: 'value', fallback: '3', help: 'rounds per spot (1-1000)' },
  { name: '--budget', kind: 'value', fallback: '60', help: 'bot time budget in seconds (60-600)' },
  { name: '--move-limit', kind: 'value', fallback: '4', help: 'paid looks per round (0-20)' },
  {
    name: '--image-size',
    kind: 'value',
    fallback: '640',
    help: 'image size shown to the bot: 256, 400 or 640',
  },
  {
    name: '--concurrency',
    kind: 'value',
    fallback: '1',
    help: 'rounds in parallel (1-3, hard cap)',
  },
  { name: '--limit', kind: 'value', fallback: 'all', help: 'use only the first N selected spots' },
  {
    name: '--label',
    kind: 'value',
    fallback: 'none',
    help: 'name the run; copy aggregate summary to docs/evals/results/<label>.json',
  },
  {
    name: '--out',
    kind: 'value',
    fallback: '.geoaissr-dev/evals/<run>',
    help: 'output directory for rounds.jsonl and summary.json',
  },
];

export function evalHelpText(): string {
  const width = Math.max(...FLAG_SPECS.map((f) => f.name.length + (f.kind === 'bool' ? 0 : 8)));
  const lines = FLAG_SPECS.map((f) => {
    const label = f.kind === 'bool' ? f.name : `${f.name} <value>`;
    return `  ${label.padEnd(width + 2)}${f.help} (default: ${f.fallback})`;
  });
  return [
    'Usage: bun run eval:bots -- [flags]',
    'Both "--flag value" and "--flag=value" are accepted. Unknown, duplicate or malformed flags exit 2.',
    '',
    ...lines,
    '',
    'Exit codes: 0 ok, 1 harness launch failed (GEO_EVAL_HARNESS_FAILED), 2 invalid arguments (GEO_INVALID_ARGS), 130 interrupted.',
  ].join('\n');
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** Closest known flag, or null when nothing is plausibly close. */
export function closestFlag(name: string): string | null {
  let best: { flag: string; dist: number } | null = null;
  for (const spec of FLAG_SPECS) {
    const dist = editDistance(name, spec.name);
    if (best === null || dist < best.dist) best = { flag: spec.name, dist };
  }
  return best !== null && best.dist <= Math.max(2, Math.floor(name.length / 3)) ? best.flag : null;
}

interface RawFlags {
  values: Map<string, string>;
  bools: Set<string>;
  spots: string[];
}

function splitToken(token: string): { name: string; inline: string | null } {
  const eq = token.indexOf('=');
  return eq < 0
    ? { name: token, inline: null }
    : { name: token.slice(0, eq), inline: token.slice(eq + 1) };
}

function collectFlags(argv: readonly string[]): RawFlags {
  const raw: RawFlags = { values: new Map(), bools: new Set(), spots: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    if (!token.startsWith('--')) {
      throw new EvalArgsError(`unexpected argument "${token}"; flags start with "--"`);
    }
    const { name, inline } = splitToken(token);
    const spec = FLAG_SPECS.find((f) => f.name === name);
    if (!spec) {
      const near = closestFlag(name);
      throw new EvalArgsError(
        `unknown flag ${name}`,
        near ? `did you mean ${near}?` : 'see --help',
      );
    }
    if (spec.kind !== 'repeatable' && (raw.bools.has(name) || raw.values.has(name))) {
      throw new EvalArgsError(`duplicate flag ${name}`);
    }
    if (spec.kind === 'bool') {
      if (inline !== null) throw new EvalArgsError(`flag ${name} takes no value`);
      raw.bools.add(name);
      continue;
    }
    let value = inline;
    if (value === null) {
      value = argv[i + 1] ?? '';
      if (value === '' || value.startsWith('--')) {
        throw new EvalArgsError(`flag ${name} requires a value`);
      }
      i += 1;
    }
    if (value === '') throw new EvalArgsError(`flag ${name} requires a non-empty value`);
    if (spec.kind === 'repeatable') raw.spots.push(value);
    else raw.values.set(name, value);
  }
  return raw;
}

function intFlag(
  raw: RawFlags,
  flag: string,
  fallback: number,
  range: readonly [number, number],
): number {
  const text = raw.values.get(flag);
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!/^-?\d+$/.test(text) || n < range[0] || n > range[1]) {
    throw new EvalArgsError(
      `flag ${flag} requires an integer in ${range[0]}..${range[1]}, got "${text}"`,
    );
  }
  return n;
}

function validateSpots(spots: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const id of spots) {
    if (!SPOT_ID_PATTERN.test(id)) {
      throw new EvalArgsError(
        `flag --spot got a malformed spot id "${id}"`,
        `ids match ${SPOT_ID_PATTERN.source}`,
      );
    }
    if (seen.has(id)) throw new EvalArgsError(`duplicate flag --spot ${id}`);
    seen.add(id);
  }
  return [...spots];
}

function parseImageSize(raw: RawFlags): EvalImageSize {
  const size = intFlag(raw, '--image-size', 640, [256, 640]);
  if (size !== 256 && size !== 400 && size !== 640) {
    throw new EvalArgsError(`flag --image-size must be 256, 400 or 640, got "${size}"`);
  }
  return size;
}

function parseHarness(raw: RawFlags): HarnessId {
  const harness = raw.values.get('--harness') ?? 'claude';
  if (!(HARNESS_IDS as readonly string[]).includes(harness)) {
    throw new EvalArgsError(`unknown harness "${harness}"`, `allowed: ${HARNESS_IDS.join(', ')}`);
  }
  return harness as HarnessId;
}

function parseLabel(raw: RawFlags): string | null {
  const label = raw.values.get('--label') ?? null;
  if (label !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
    throw new EvalArgsError(
      `flag --label allows only letters, digits, ".", "_" and "-", got "${label}"`,
    );
  }
  return label;
}

/** Strict parser: throws {@link EvalArgsError} for unknown, duplicate or malformed flags. */
export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  const raw = collectFlags(argv);
  return {
    dry: raw.bools.has('--dry'),
    help: raw.bools.has('--help'),
    harness: parseHarness(raw),
    datasetDir: raw.values.get('--dataset') ?? null,
    spotIds: validateSpots(raw.spots),
    repeats: intFlag(raw, '--repeats', 3, [1, 1000]),
    budgetSec: intFlag(raw, '--budget', 60, [60, 600]),
    moveLimit: intFlag(raw, '--move-limit', 4, [0, 20]),
    imageSize: parseImageSize(raw),
    concurrency: intFlag(raw, '--concurrency', 1, [1, 3]),
    label: parseLabel(raw),
    outDir: raw.values.get('--out') ?? null,
    limit: raw.values.has('--limit') ? intFlag(raw, '--limit', 1, [1, 100000]) : null,
  };
}

/** One stderr line: problem, suggestion and the registered code. */
export function formatEvalArgsError(err: EvalArgsError): string {
  const parts = [`eval:bots: ${err.message}`];
  if (err.suggestion) parts.push(err.suggestion);
  return `${parts.join('; ')} (GEO_INVALID_ARGS)`;
}
