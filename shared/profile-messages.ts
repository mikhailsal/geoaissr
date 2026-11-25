import { z } from 'zod';
import { AVATAR_GESTURES, avatarAppearanceSchema } from './avatar.ts';
import { PARTICIPANT_COLOR_IDS } from './colors.ts';
import { hasTerminalControlCharacters } from './display-name.ts';

export const MAX_NICK_LEN = 20;

export const participantNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NICK_LEN)
  .refine(
    (value) => !hasTerminalControlCharacters(value),
    'Имя не должно содержать управляющие символы',
  );

export const helloMessageSchema = z.object({
  type: z.literal('hello'),
  expectedRole: z.literal('host').optional(),
  token: z.string().min(1).max(128),
  playerId: z.string().min(1).max(64).optional(),
  playerSecret: z.string().min(1).max(128).optional(),
  profileId: z.string().min(1).max(64).optional(),
});

export const profileLoginMessageSchema = z
  .object({
    type: z.literal('profile_login'),
    profileToken: z.string().max(64),
    expectedRole: z.literal('host').optional(),
  })
  .strict();

export const joinMessageSchema = z.object({
  type: z.literal('join'),
  seq: z.number().int().nonnegative(),
  nick: participantNameSchema,
  avatar: avatarAppearanceSchema.optional(),
  color: z.enum(PARTICIPANT_COLOR_IDS),
  profileId: z.string().min(1).max(64).optional(),
});

export const updateProfileMessageSchema = joinMessageSchema
  .omit({ profileId: true })
  .extend({ type: z.literal('update_profile') });

/** A lobby-only host action to release a disconnected guest's room seat. */
export const releaseGuestSeatMessageSchema = z
  .object({
    type: z.literal('release_guest_seat'),
    seq: z.number().int().nonnegative(),
    playerId: z.string().min(1).max(64),
  })
  .strict();

export const avatarGestureMessageSchema = z
  .object({
    type: z.literal('avatar_gesture'),
    seq: z.number().int().nonnegative(),
    gesture: z.enum(AVATAR_GESTURES),
    botId: z.string().min(1).max(64).optional(),
  })
  .strict();

export const avatarSpinMessageSchema = z
  .object({
    type: z.literal('avatar_spin'),
    seq: z.number().int().nonnegative(),
    participantId: z.string().min(1).max(64),
  })
  .strict();

export const avatarTurnMessageSchema = avatarSpinMessageSchema.extend({
  type: z.literal('avatar_turn'),
  yaw: z.number().finite().min(-Math.PI).max(Math.PI),
});
