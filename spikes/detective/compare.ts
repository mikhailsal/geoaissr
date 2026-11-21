import { readFileSync } from 'node:fs';
import { quantile } from '../../scripts/eval-bots/metrics.ts';

/**
 * Leak comparison (pre-registration, "Other reported numbers"): the brain fed the eyes' answers
 * against the brain fed the human labels, paired by spot. `--paired` compares any two arms.
 *   bun run spikes/detective/compare.ts [--paired] <a rounds.jsonl> <b rounds.jsonl>
 */

export interface ErrorRow {
  spotId: string;
  errorKm: number | null;
  infraError: string | null;
}

function spotMedians(rows: readonly ErrorRow[]): Map<string, number | null> {
  const bySpot = new Map<string, number[]>();
  for (const r of rows) {
    if (r.infraError !== null) continue;
    const list = bySpot.get(r.spotId) ?? [];
    // A round without a pin scores as the worst case: the far side of the globe.
    list.push(r.errorKm ?? 20_000);
    bySpot.set(r.spotId, list);
  }
  return new Map([...bySpot].map(([id, list]) => [id, quantile(list, 0.5)]));
}

/** Two arms paired by spot: the median of each spot's passes, a against b. */
export function pairedBySpot(a: readonly ErrorRow[], b: readonly ErrorRow[]) {
  const am = spotMedians(a);
  const bm = spotMedians(b);
  const scored = [...am.keys()]
    .filter((id) => bm.has(id))
    .sort()
    .map((spotId) => ({ spotId, aKm: am.get(spotId) ?? null, bKm: bm.get(spotId) ?? null }))
    .filter(
      (p): p is { spotId: string; aKm: number; bKm: number } => p.aKm !== null && p.bKm !== null,
    );
  const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  const median = (values: number[]) => r1(quantile(values, 0.5));
  return {
    spots: scored.length,
    aCloser: scored.filter((p) => p.aKm < p.bKm).length,
    bCloser: scored.filter((p) => p.bKm < p.aKm).length,
    ties: scored.filter((p) => p.aKm === p.bKm).length,
    medianOfSpotMediansKm: {
      a: median(scored.map((p) => p.aKm)),
      b: median(scored.map((p) => p.bKm)),
    },
    medianPairedDifferenceKm: median(scored.map((p) => p.aKm - p.bKm)),
    pairs: scored.map((p) => ({ spotId: p.spotId, aKm: r1(p.aKm), bKm: r1(p.bKm) })),
  };
}

export function leakComparison(detective: readonly ErrorRow[], labels: readonly ErrorRow[]) {
  const p = pairedBySpot(detective, labels);
  return {
    spots: p.spots,
    detectiveCloser: p.aCloser,
    labelsCloser: p.bCloser,
    ties: p.ties,
    medianOfSpotMediansKm: {
      detective: p.medianOfSpotMediansKm.a,
      labels: p.medianOfSpotMediansKm.b,
    },
    medianPairedDifferenceKm: p.medianPairedDifferenceKm,
    pairs: p.pairs.map((x) => ({ spotId: x.spotId, detectiveKm: x.aKm, labelsKm: x.bKm })),
  };
}

function readRows(file: string): ErrorRow[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ErrorRow);
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const paired = argv[0] === '--paired';
  const [aFile, bFile] = paired ? argv.slice(1) : argv;
  if (!aFile || !bFile) {
    console.error('usage: compare.ts [--paired] <a rounds.jsonl> <b rounds.jsonl>');
    process.exit(2);
  }
  const a = readRows(aFile);
  const b = readRows(bFile);
  console.log(JSON.stringify(paired ? pairedBySpot(a, b) : leakComparison(a, b), null, 2));
}
