import {
  MOVE_DISTANCE_MAX_M,
  QUIP_MAX_LEN,
  type PersonalityPreset,
} from '../../../shared/bot-tools.ts';
import { MAX_REQUESTS, PRE_REPORT_ACTIONS } from '../../../shared/detective-tools.ts';
import { loadPrompt } from '../prompt-files.ts';
import { buildToneLine } from '../prompt.ts';

/** Start prompts of the two Detective roles, filled in from `server/bots/prompts/`. */

export interface DetectivePromptOptions {
  regionLabelRu: string;
  regionDiagonalKm: number;
  budgetSec: number;
  /** Paid camera actions of the eyes in the round. */
  moveLimit: number;
  /** The eyes can drive along the road this round. */
  canMove: boolean;
  personalityPreset: PersonalityPreset;
  personalityText: string;
}

export function buildDetectiveBrainPrompt(opts: DetectivePromptOptions): string {
  return loadPrompt('detective-brain.txt', {
    regionLabel: opts.regionLabelRu,
    regionDiagonalKm: Math.round(opts.regionDiagonalKm),
    budgetSec: opts.budgetSec,
    maxRequests: MAX_REQUESTS,
    moveLimit: opts.moveLimit,
    moveDistanceMax: MOVE_DISTANCE_MAX_M,
    quipMaxLen: QUIP_MAX_LEN,
    toneLine: buildToneLine(opts.personalityPreset, opts.personalityText),
    moveEnabled: opts.canMove,
    hasTurns: opts.moveLimit > 0,
  });
}

export function buildDetectiveEyesPrompt(
  opts: Pick<DetectivePromptOptions, 'moveLimit' | 'canMove'>,
): string {
  return loadPrompt('detective-eyes.txt', {
    moveLimit: opts.moveLimit,
    preReportActions: Math.min(PRE_REPORT_ACTIONS, opts.moveLimit),
    moveDistanceMax: MOVE_DISTANCE_MAX_M,
    moveEnabled: opts.canMove,
    hasTurns: opts.moveLimit > 0,
  });
}
