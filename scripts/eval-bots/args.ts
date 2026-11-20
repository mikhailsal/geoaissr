import { HARNESS_IDS, type HarnessId } from '../../shared/storage-schemas.ts';

export type EvalImageSize = 256 | 400 | 640;

export interface EvalArgs {
  dry: boolean;
  harness: HarnessId;
  datasetDir: string | null;
  repeats: number;
  budgetSec: number;
  moveLimit: number;
  imageSize: EvalImageSize;
  concurrency: number;
  label: string | null;
  outDir: string | null;
  /** Number of spots to use (first N of the manifest); null means all. */
  limit: number | null;
}

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  const val = argv[idx + 1];
  if (!val || val.startsWith('--')) {
    throw new Error(`Flag ${flag} requires a non-empty value`);
  }
  return val;
}

function readInt(
  argv: readonly string[],
  flag: string,
  fallback: number,
  range: readonly [number, number],
): number {
  const raw = readFlagValue(argv, flag);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < range[0] || n > range[1]) {
    throw new Error(`Flag ${flag} requires an integer in ${range[0]}..${range[1]}, got: ${raw}`);
  }
  return n;
}

export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  const rawHarness = readFlagValue(argv, '--harness') ?? 'claude';
  if (!(HARNESS_IDS as readonly string[]).includes(rawHarness)) {
    throw new Error(`Unknown harness "${rawHarness}". Allowed: ${HARNESS_IDS.join(', ')}`);
  }
  const imageSize = readInt(argv, '--image-size', 640, [256, 640]);
  if (imageSize !== 256 && imageSize !== 400 && imageSize !== 640) {
    throw new Error(`Flag --image-size must be 256, 400 or 640, got: ${imageSize}`);
  }
  const label = readFlagValue(argv, '--label');
  if (label !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
    throw new Error(`Flag --label allows only letters, digits, ".", "_" and "-", got: ${label}`);
  }
  return {
    dry: argv.includes('--dry'),
    harness: rawHarness as HarnessId,
    datasetDir: readFlagValue(argv, '--dataset'),
    repeats: readInt(argv, '--repeats', 3, [1, 1000]),
    budgetSec: readInt(argv, '--budget', 60, [60, 600]),
    moveLimit: readInt(argv, '--move-limit', 4, [0, 20]),
    imageSize,
    concurrency: readInt(argv, '--concurrency', 1, [1, 3]),
    label,
    outDir: readFlagValue(argv, '--out'),
    limit:
      readFlagValue(argv, '--limit') === null ? null : readInt(argv, '--limit', 1, [1, 100000]),
  };
}
