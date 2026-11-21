import { readFileSync } from 'node:fs';

/**
 * Blind extract for the unsupported-finding judge: the step findings of two arms on the same
 * spots, with arm and role markers masked and the order shuffled with a fixed seed.
 */

export type JudgeArm = 'detective' | 'single';

export interface FindingItem {
  spotId: string;
  arm: JudgeArm;
  executionId: string;
  text: string;
}

export interface BlindItem {
  n: number;
  text: string;
}

export interface SpotBatch {
  spotId: string;
  items: BlindItem[];
  /** n -> source item; kept away from the judge. */
  key: Map<number, FindingItem>;
}

interface DetectiveRow {
  spotId: string;
  executionId: string;
  infraError: string | null;
  asks: Array<{ finding: string | null; findingState: string }>;
}

interface SingleRow {
  spotId: string;
  executionId: string;
  infraError: string | null;
  steps: Array<{ finding?: string | null }>;
}

function readJsonl(file: string): unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

/** Detective step findings: `ask.finding` from the second ask on. */
export function detectiveFindings(file: string): FindingItem[] {
  return (readJsonl(file) as DetectiveRow[])
    .filter((r) => r.infraError === null)
    .flatMap((r) =>
      r.asks
        .filter((a) => a.findingState === 'recorded' && a.finding)
        .map((a) => ({
          spotId: r.spotId,
          arm: 'detective' as const,
          executionId: r.executionId,
          text: a.finding ?? '',
        })),
    );
}

/** Stage 1 single-agent step findings (`look` steps of eval:bots rounds). */
export function singleFindings(file: string): FindingItem[] {
  return (readJsonl(file) as SingleRow[])
    .filter((r) => r.infraError === null)
    .flatMap((r) =>
      r.steps
        .filter((s) => typeof s.finding === 'string' && s.finding.trim().length > 0)
        .map((s) => ({
          spotId: r.spotId,
          arm: 'single' as const,
          executionId: r.executionId,
          text: s.finding ?? '',
        })),
    );
}

const MASKS: RegExp[] = [
  /(?<!\p{L})мозг\p{L}*/giu,
  /(?<!\p{L})глаз\p{L}*/giu,
  /(?<!\p{L})напарник\p{L}*/giu,
  /(?<!\p{L})ответ\p{L}*/giu,
  /(?<!\p{L})запрос\p{L}*/giu,
  /(?<!\p{L})кадр\p{L}*\s*\d+/giu,
];

/** Masks words that tell the two arms apart by role rather than by content. */
export function maskRoleWords(text: string): string {
  return MASKS.reduce((acc, re) => acc.replace(re, '[…]'), text);
}

/** Deterministic PRNG (mulberry32) so the blind order can be reproduced from the seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export function buildBatches(items: readonly FindingItem[], seed: number): SpotBatch[] {
  const rand = seededRandom(seed);
  const bySpot = new Map<string, FindingItem[]>();
  for (const item of items) {
    const list = bySpot.get(item.spotId) ?? [];
    list.push(item);
    bySpot.set(item.spotId, list);
  }
  return [...bySpot.keys()].sort().map((spotId) => {
    const shuffled = shuffle(bySpot.get(spotId) ?? [], rand);
    const key = new Map<number, FindingItem>();
    const blind = shuffled.map((item, idx) => {
      key.set(idx + 1, item);
      return { n: idx + 1, text: maskRoleWords(item.text) };
    });
    return { spotId, items: blind, key };
  });
}
