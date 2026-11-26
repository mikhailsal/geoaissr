import { z } from 'zod';

/**
 * Client messages that leave a screen the host moves everyone on from: the round results and the
 * final screen. A guest's «Готов» only tells the host who has finished reading.
 */

export const nextRoundMessageSchema = z.object({
  type: z.enum(['next_round', 'ready_next']),
  seq: z.number().int().nonnegative(),
  roundNumber: z.number().int().positive(),
  /** next_round: the host has been asked and starts without those who are not ready. */
  force: z.boolean().optional(),
  /** ready_next: the match of the click; a click that arrives in a later match is dropped. */
  matchId: z.string().max(64).optional(),
});

export const leaveFinalMessageSchema = z.object({
  type: z.enum(['play_again', 'ready_lobby']),
  seq: z.number().int().nonnegative(),
  /** play_again: the host has been asked and goes back to the lobby without those not ready. */
  force: z.boolean().optional(),
  /** ready_lobby: the `gen` of the final screen clicked on; a click on an earlier one is dropped. */
  gen: z.number().int().nonnegative().optional(),
});
