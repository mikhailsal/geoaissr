import {
  DETECTIVE_MIN_BUDGET_SEC,
  eyesDiffer,
  eyesModel,
  resolvePlayStyle,
  type PlayStyle,
  type RoleSlot,
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
  if (fallback === 'budget') {
    return RU.playStyle.fallbackBudget(roundDurationSec, DETECTIVE_MIN_BUDGET_SEC);
  }
  return null;
}

/**
 * The style part of a bot's line in the lobby: « · Детектив», with the eyes' harness and model
 * when they differ from the brain's. Empty for a bot that plays Intuit in this match.
 */
export function styleSuffix(slot: RoleSlot & StyleSlot, roundDurationSec: number): string {
  if (playedStyle(slot, roundDurationSec) !== 'detective') return '';
  if (!eyesDiffer(slot)) return ` · ${RU.playStyle.detective}`;
  const eyes = eyesModel(slot);
  return ` · ${RU.playStyle.detective}, ${RU.playStyle.eyes.toLowerCase()}: ${eyes.harness} · ${eyes.model}`;
}
