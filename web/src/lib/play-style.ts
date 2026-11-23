import {
  DETECTIVE_HARNESSES,
  DETECTIVE_MIN_BUDGET_SEC,
  resolvePlayStyle,
  type PlayStyle,
  type StyleSlot,
} from '../../../shared/play-style';
import { RU } from '../i18n/ru';

const INTUIT_MIN_BUDGET_SEC = 60;

/** The lowest round budget the lobby accepts for this slot. */
export function minBudgetSec(slot: StyleSlot): number {
  return slot.playStyle === 'detective' ? DETECTIVE_MIN_BUDGET_SEC : INTUIT_MIN_BUDGET_SEC;
}

export const DETECTIVE_BUDGET_HINT = RU.playStyle.minBudgetHint(DETECTIVE_MIN_BUDGET_SEC);

/** The style the slot will really play in a match with this round duration. */
export function playedStyle(slot: StyleSlot, roundDurationSec: number): PlayStyle {
  return resolvePlayStyle(slot, roundDurationSec).style;
}

/** Why a slot set to Detective will play Intuit, in words; null when it plays what it is set to. */
export function fallbackNote(slot: StyleSlot, roundDurationSec: number): string | null {
  const { fallback } = resolvePlayStyle(slot, roundDurationSec);
  if (fallback === 'harness') {
    return RU.playStyle.fallbackHarness(DETECTIVE_HARNESSES.join(', '), slot.harness);
  }
  if (fallback === 'budget') {
    return RU.playStyle.fallbackBudget(roundDurationSec, DETECTIVE_MIN_BUDGET_SEC);
  }
  return null;
}
