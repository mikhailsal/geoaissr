import { readFileSync } from 'node:fs';
import { quantile } from '../../scripts/eval-bots/metrics.ts';

/**
 * Leak comparison (pre-registration, "Other reported numbers"): the brain fed the eyes' answers
 * against the brain fed the human labels, paired by spot.
 *   bun run spikes/detective/compare.ts <detective rounds.jsonl> <labels rounds.jsonl>
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

export function leakComparison(detective: readonly ErrorRow[], labels: readonly ErrorRow[]) {
  const det = spotMedians(detective);
  const lab = spotMedians(labels);
  const pairs = [...det.keys()]
    .filter((id) => lab.has(id))
    .sort()
    .map((spotId) => ({
      spotId,
      detectiveKm: det.get(spotId) ?? null,
      labelsKm: lab.get(spotId) ?? null,
    }));
  const scored = pairs.filter(
    (p): p is { spotId: string; detectiveKm: number; labelsKm: number } =>
      p.detectiveKm !== null && p.labelsKm !== null,
  );
  const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    spots: scored.length,
    detectiveCloser: scored.filter((p) => p.detectiveKm < p.labelsKm).length,
    labelsCloser: scored.filter((p) => p.labelsKm < p.detectiveKm).length,
    ties: scored.filter((p) => p.labelsKm === p.detectiveKm).length,
    medianOfSpotMediansKm: {
      detective: r1(
        quantile(
          scored.map((p) => p.detectiveKm),
          0.5,
        ),
      ),
      labels: r1(
        quantile(
          scored.map((p) => p.labelsKm),
          0.5,
        ),
      ),
    },
    medianPairedDifferenceKm: r1(
      quantile(
        scored.map((p) => p.detectiveKm - p.labelsKm),
        0.5,
      ),
    ),
    pairs: scored.map((p) => ({ ...p, detectiveKm: r1(p.detectiveKm), labelsKm: r1(p.labelsKm) })),
  };
}

function readRows(file: string): ErrorRow[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ErrorRow);
}

if (import.meta.main) {
  const [detFile, labFile] = Bun.argv.slice(2);
  if (!detFile || !labFile) {
    console.error('usage: compare.ts <detective rounds.jsonl> <labels rounds.jsonl>');
    process.exit(2);
  }
  console.log(JSON.stringify(leakComparison(readRows(detFile), readRows(labFile)), null, 2));
}
