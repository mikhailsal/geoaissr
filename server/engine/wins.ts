import type { MatchRecord } from '../../shared/storage-schemas.ts';

export const WIN_WINDOW_MS = 6 * 60 * 60 * 1000;
export function computeWins6h(
  records: MatchRecord[],
  nowMs: number,
  botResetAtById: Record<string, string | undefined>,
): { byProfileId: Record<string, number>; byBotId: Record<string, number> } {
  const byProfileId: Record<string, number> = Object.create(null) as Record<string, number>;
  const byBotId: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const record of records) {
    const ended = Date.parse(record.endedAt);
    if (
      !Number.isFinite(ended) ||
      ended < nowMs - WIN_WINDOW_MS ||
      ended > nowMs ||
      record.playedRounds !== record.plannedRounds
    )
      continue;
    const winners = record.participants.filter((p) => p.rank === 1);
    if (winners.length !== 1) continue;
    const winner = winners[0];
    if (!winner) continue;
    if (winner.isAi) {
      const reset = Object.hasOwn(botResetAtById, winner.id)
        ? botResetAtById[winner.id]
        : undefined;
      if (reset && !(ended > Date.parse(reset))) continue;
      byBotId[winner.id] = (byBotId[winner.id] ?? 0) + 1;
    } else if (winner.profileId) {
      byProfileId[winner.profileId] = (byProfileId[winner.profileId] ?? 0) + 1;
    }
  }
  return { byProfileId, byBotId };
}

export function createWinsClock(
  records: MatchRecord[],
  nowFn: () => number,
  getResets: () => Record<string, string | undefined>,
  update: (wins: ReturnType<typeof computeWins6h>, broadcast: boolean) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function refresh(broadcast = false): void {
    if (timer) clearTimeout(timer);
    const now = nowFn();
    let next = Infinity;
    let kept = 0;
    for (const record of records) {
      const ended = Date.parse(record.endedAt);
      if (
        !Number.isFinite(ended) ||
        ended < now - WIN_WINDOW_MS ||
        record.playedRounds !== record.plannedRounds
      )
        continue;
      const winners = record.participants.filter((participant) => participant.rank === 1);
      if (winners.length !== 1 || (!winners[0]?.isAi && !winners[0]?.profileId)) continue;
      records[kept++] = record;
      if (ended > now) next = Math.min(next, ended);
      next = Math.min(next, ended + WIN_WINDOW_MS + 1);
    }
    records.length = kept;
    update(computeWins6h(records, now, getResets()), broadcast);
    if (Number.isFinite(next))
      timer = setTimeout(
        () => {
          refresh(true);
        },
        Math.min(next - now, 2_147_483_647),
      );
  }
  return {
    refresh,
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  };
}
