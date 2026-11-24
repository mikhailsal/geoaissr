import type { EffortLevel } from './bot-tools.ts';
import type { HarnessCatalogEntry } from './protocol.ts';
import type { HarnessId } from './storage-schemas.ts';

/**
 * How a bot plays a round. `intuit` is one process that sees the frames and guesses. `detective`
 * is a pair: the brain decides and never sees a frame, the eyes see and never name a place.
 */
export const PLAY_STYLES = ['intuit', 'detective'] as const;
export type PlayStyle = (typeof PLAY_STYLES)[number];

/** Below this budget the scene report and two requests do not fit into the round. */
export const DETECTIVE_MIN_BUDGET_SEC = 90;

/** Describing frames needs no long thinking; the spikes measured the eyes at low effort. */
export const EYES_EFFORT: EffortLevel = 'low';

/** Why a bot set to Detective plays Intuit in this match. */
export type PlayStyleFallback = 'budget';

export interface ResolvedPlayStyle {
  style: PlayStyle;
  /** Set only when the slot asks for Detective and cannot have it. */
  fallback?: PlayStyleFallback;
}

/** The slot fields the play style depends on. */
export interface StyleSlot {
  playStyle?: PlayStyle | undefined;
  budgetSec: number;
}

/** The CLI and the model one process of a bot runs on. */
export interface RoleModel {
  harness: HarnessId;
  model: string;
}

/** The slot fields that say where the processes of a bot run. */
export interface RoleSlot {
  playStyle?: PlayStyle | undefined;
  harness: HarnessId;
  model: string;
  effort: EffortLevel;
  /** Detective only: the eyes' own CLI and model; absent means the brain's. */
  eyes?: RoleModel | undefined;
}

/** Where the eyes of a Detective run: their own harness and model, or the brain's. */
export function eyesModel(slot: RoleSlot): RoleModel {
  return slot.eyes ?? { harness: slot.harness, model: slot.model };
}

/** The eyes run on another CLI or model than the brain. */
export function eyesDiffer(slot: RoleSlot): boolean {
  const eyes = eyesModel(slot);
  return eyes.harness !== slot.harness || eyes.model !== slot.model;
}

/** Every harness a slot set to this style launches: the brain's, and the eyes' for a Detective. */
export function slotHarnesses(slot: RoleSlot): HarnessId[] {
  if (slot.playStyle !== 'detective') return [slot.harness];
  const eyes = eyesModel(slot).harness;
  return eyes === slot.harness ? [slot.harness] : [slot.harness, eyes];
}

/**
 * Why the slot cannot launch: the first of its harnesses that is missing on this computer, in
 * words. Undefined when every harness it needs is ready.
 */
export function harnessProblem(
  slot: RoleSlot,
  catalog: readonly Pick<HarnessCatalogEntry, 'id' | 'available' | 'reason'>[],
): string | undefined {
  for (const id of slotHarnesses(slot)) {
    const entry = catalog.find((h) => h.id === id);
    if (entry?.available) continue;
    const reason = entry?.reason ?? `Харнесс ${id} недоступен`;
    return id === slot.harness ? reason : `Глаза детектива: ${reason}`;
  }
  return undefined;
}

/**
 * What «Проверить зрение» tests: the process that sees the frames. For a Detective these are the
 * eyes, at the effort they play with.
 */
export function visionSubject(slot: RoleSlot): RoleModel & { effort: EffortLevel } {
  if (slot.playStyle === 'detective') return { ...eyesModel(slot), effort: EYES_EFFORT };
  return { harness: slot.harness, model: slot.model, effort: slot.effort };
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
  if (Math.min(slot.budgetSec, roundDurationSec) < DETECTIVE_MIN_BUDGET_SEC) {
    return { style: 'intuit', fallback: 'budget' };
  }
  return { style: 'detective' };
}
