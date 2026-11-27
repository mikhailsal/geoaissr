/** The API price shown in the bot accounting badge: three decimals, «н/д» when it is unknown. */
export function formatApiPrice(costUsd: number | null | undefined): string {
  return costUsd != null ? `~$${costUsd.toFixed(3)}` : 'н/д';
}
