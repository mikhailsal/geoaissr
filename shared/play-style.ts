/**
 * How a bot plays a round. `intuit` is one process that sees the frames and guesses. `detective`
 * is a pair: the brain decides and never sees a frame, the eyes see and never name a place.
 */
export const PLAY_STYLES = ['intuit', 'detective'] as const;
export type PlayStyle = (typeof PLAY_STYLES)[number];

/** Below this budget the scene report and two requests do not fit into the round. */
export const DETECTIVE_MIN_BUDGET_SEC = 90;

/** Harnesses whose Detective launch has run with a real model. The others play Intuit. */
export const DETECTIVE_HARNESSES: readonly string[] = ['claude'];

export function harnessSupportsDetective(harness: string): boolean {
  return DETECTIVE_HARNESSES.includes(harness);
}

/** Why a bot set to Detective plays Intuit in this match. */
export type PlayStyleFallback = 'budget' | 'harness';

export interface ResolvedPlayStyle {
  style: PlayStyle;
  /** Set only when the slot asks for Detective and cannot have it. */
  fallback?: PlayStyleFallback;
}

/** The slot fields the play style depends on. */
export interface StyleSlot {
  playStyle?: PlayStyle | undefined;
  harness: string;
  budgetSec: number;
}

/** Slot id → why that slot, set to Detective, plays Intuit in a round of this duration. */
export function styleFallbacks(
  slots: ReadonlyArray<StyleSlot & { id: string }>,
  roundDurationSec: number,
): Record<string, PlayStyleFallback> {
  const out: Record<string, PlayStyleFallback> = {};
  for (const slot of slots) {
    const { fallback } = resolvePlayStyle(slot, roundDurationSec);
    if (fallback) out[slot.id] = fallback;
  }
  return out;
}

/**
 * The style a slot really plays. The round duration caps the bot's budget, so a Detective bot in
 * a round shorter than the minimum plays Intuit for that match.
 */
export function resolvePlayStyle(slot: StyleSlot, roundDurationSec: number): ResolvedPlayStyle {
  if (slot.playStyle !== 'detective') return { style: 'intuit' };
  if (!harnessSupportsDetective(slot.harness)) return { style: 'intuit', fallback: 'harness' };
  if (Math.min(slot.budgetSec, roundDurationSec) < DETECTIVE_MIN_BUDGET_SEC) {
    return { style: 'intuit', fallback: 'budget' };
  }
  return { style: 'detective' };
}
