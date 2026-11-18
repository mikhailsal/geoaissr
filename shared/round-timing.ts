/** Minimum loading time for the complete loading-round.ogg phrase before counting. */
export const ROUND_INTRO_MS = 6_800;
/** The three displayed counts before a round becomes active. */
export const COUNTDOWN_MS = 3_000;
export const PANO_LOAD_TIMEOUT_MS = 5_000;

export interface RoundCompletion {
  /** Server timestamp in milliseconds at which the round ended. */
  finishedAt: number;
  /** Players who confirmed a guess and bots that finished successfully. */
  confirmedIds: string[];
}
