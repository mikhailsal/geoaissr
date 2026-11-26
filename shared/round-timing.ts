/** Minimum loading time for the complete loading-round.ogg phrase before counting. */
export const ROUND_INTRO_MS = 6_800;
/** The three displayed counts before a round becomes active. */
export const COUNTDOWN_MS = 3_000;
export const PANO_LOAD_TIMEOUT_MS = 5_000;
/**
 * How long after the shown end of a round the server still takes a pin. A pin moved in the last
 * second leaves the browser up to 200 ms later (pin messages are throttled) and then crosses the
 * network; without the wait it arrived after the round had closed and the older pin was scored.
 */
export const LATE_PIN_GRACE_MS = 1_000;

export interface RoundCompletion {
  /** Server timestamp in milliseconds at which the round ended. */
  finishedAt: number;
  /** Players who confirmed a guess and bots that finished successfully. */
  confirmedIds: string[];
}
