import type { RoundRecord } from './records.ts';

export function firstInfraError(records: readonly RoundRecord[]): RoundRecord | null {
  return records.find((r) => r.infraError !== null) ?? null;
}

/** One stderr line for a harness failure: where, how to fix, where the evidence is, and the code. */
export function formatHarnessFailure(
  record: RoundRecord,
  infraRounds: number,
  roundsFile: string,
): string {
  const detail = (record.infraError ?? '').replace(/\s+/g, ' ').slice(0, 160);
  return (
    `eval:bots: harness launch failed at spot ${record.spotId} attempt ${record.repeat}` +
    ` (${infraRounds} infra error round(s), not measured): ${detail};` +
    ` fix: bun run doctor; rounds: ${roundsFile} (GEO_EVAL_HARNESS_FAILED)`
  );
}
