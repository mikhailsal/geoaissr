import {
  botNameFromModel,
  isAutoBotName,
  personalityTextSchema,
  type BotImageSize,
  type EffortLevel,
  type PersonalityPreset,
} from '../../shared/bot-tools.ts';
import {
  DETECTIVE_MIN_BUDGET_SEC,
  harnessProblem,
  visionSubject,
} from '../../shared/play-style.ts';
import type { HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { BotSlotConfig, HarnessId } from '../../shared/storage-schemas.ts';

/**
 * How a host's edit of a bot slot in the lobby lands on the saved slot: the harness and model, the
 * play style and the Detective's eyes, the tuning, and whether a stored vision check still counts.
 */

/** A Detective needs time for the scene report and two requests: its budget never goes below. */
function applyPlayStylePatch(next: BotSlotConfig, patch: Record<string, unknown>): void {
  if (patch.playStyle === 'intuit' || patch.playStyle === 'detective') {
    next.playStyle = patch.playStyle;
  }
  if (next.playStyle === 'detective' && next.budgetSec < DETECTIVE_MIN_BUDGET_SEC) {
    next.budgetSec = DETECTIVE_MIN_BUDGET_SEC;
  }
}

interface EyesPatch {
  harness: HarnessId;
  model?: string;
}

/** A patch moves the eyes to a harness (and model) of their own, or `null` back to the brain's. */
function eyesPatchOf(patch: Record<string, unknown>): EyesPatch | null | undefined {
  const eyes = patch.eyes;
  if (eyes === null) return null;
  if (typeof eyes !== 'object' || typeof (eyes as EyesPatch).harness !== 'string') return undefined;
  return eyes as EyesPatch;
}

/** The model the eyes get: the one asked for, the current one on the same harness, or the first. */
function eyesModelFor(
  slot: BotSlotConfig,
  eyes: EyesPatch,
  availableHarnesses: readonly HarnessCatalogEntry[],
): string | undefined {
  if (eyes.model !== undefined) return eyes.model;
  if (slot.eyes?.harness === eyes.harness) return slot.eyes.model;
  return availableHarnesses.find((h) => h.id === eyes.harness)?.models[0];
}

function applyEyesPatch(
  next: BotSlotConfig,
  patch: Record<string, unknown>,
  availableHarnesses: readonly HarnessCatalogEntry[],
): void {
  const eyes = eyesPatchOf(patch);
  if (eyes === null) {
    delete next.eyes;
    return;
  }
  const model = eyes && eyesModelFor(next, eyes, availableHarnesses);
  if (eyes && model) next.eyes = { harness: eyes.harness, model };
}

/** The eyes may move only to a harness that is ready and has a model to run. */
export function eyesPatchInvalid(
  slot: BotSlotConfig,
  patch: Record<string, unknown>,
  availableHarnesses: readonly HarnessCatalogEntry[],
): boolean {
  const eyes = eyesPatchOf(patch);
  if (!eyes) return false;
  const entry = availableHarnesses.find((h) => h.id === eyes.harness);
  return !entry?.available || eyesModelFor(slot, eyes, availableHarnesses) === undefined;
}

/** A stored vision check counts only while it tested what the bot would play with now. */
export function keepVisionCheck(slot: BotSlotConfig): BotSlotConfig['lastVisionCheck'] {
  const check = slot.lastVisionCheck;
  const subject = visionSubject(slot);
  return check &&
    check.model === subject.model &&
    check.effort === subject.effort &&
    check.imageSize === slot.imageSize
    ? check
    : undefined;
}

export function mergeBotSlotPatch(
  slot: BotSlotConfig,
  patch: Record<string, unknown>,
  availableHarnesses: readonly HarnessCatalogEntry[],
): BotSlotConfig {
  const next: BotSlotConfig = { ...slot };
  // An empty name hands naming back to the model (see the end of this function).
  const nameFollowsModel =
    typeof patch.name === 'string'
      ? patch.name.trim() === ''
      : isAutoBotName(slot.name, slot.model);
  if (typeof patch.name === 'string' && !nameFollowsModel) next.name = patch.name;
  if (typeof patch.color === 'string') next.color = patch.color as BotSlotConfig['color'];
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.harness === 'string') {
    next.harness = patch.harness as HarnessId;
  }
  const activeEntry = availableHarnesses.find((h) => h.id === next.harness);
  if (!activeEntry || !activeEntry.available) {
    next.enabled = false;
    next.disabledReason = activeEntry?.reason ?? `Харнесс ${next.harness} недоступен`;
  } else {
    next.disabledReason = undefined;
    if (typeof patch.harness === 'string') {
      const firstModel = activeEntry.models[0];
      if (
        typeof patch.model !== 'string' &&
        firstModel &&
        !activeEntry.models.includes(next.model)
      ) {
        next.model = firstModel;
      }
    }
  }
  if (typeof patch.model === 'string') next.model = patch.model;
  if (typeof patch.budgetSec === 'number') next.budgetSec = patch.budgetSec;
  applyPlayStylePatch(next, patch);
  applyEyesPatch(next, patch, availableHarnesses);
  // The eyes of a Detective may run on another harness: the slot needs that one too.
  const problem = harnessProblem(next, availableHarnesses);
  if (problem) {
    next.enabled = false;
    next.disabledReason = problem;
  }
  if (typeof patch.personalityPreset === 'string') {
    next.personalityPreset = patch.personalityPreset as PersonalityPreset;
  }
  if (typeof patch.personalityText === 'string') {
    const parsed = personalityTextSchema.safeParse(patch.personalityText);
    if (parsed.success) next.personalityText = parsed.data;
  }

  let changedTuning = false;
  if (typeof patch.effort === 'string') {
    next.effort = patch.effort as EffortLevel;
    changedTuning = true;
  }
  if (typeof patch.moveLimit === 'number') {
    next.moveLimit = patch.moveLimit;
    changedTuning = true;
  }
  if (typeof patch.imageSize === 'number') {
    next.imageSize = patch.imageSize as BotImageSize;
    changedTuning = true;
  }
  if (changedTuning) {
    next.difficultyPreset = 'custom';
  }
  // The presets tune the brain only, so the eyes' effort leaves the preset as it is.
  if (typeof patch.eyesEffort === 'string') next.eyesEffort = patch.eyesEffort as EffortLevel;
  if (nameFollowsModel && (next.model !== slot.model || typeof patch.name === 'string')) {
    next.name = botNameFromModel(next.model);
  }
  // The stored check does not name its harness: one run by another CLI does not count, even
  // when that CLI lists the same model id.
  next.lastVisionCheck =
    visionSubject(slot).harness === visionSubject(next).harness ? keepVisionCheck(next) : undefined;
  return next;
}
