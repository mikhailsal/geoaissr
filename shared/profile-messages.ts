import { z } from 'zod';
import { AVATAR_GESTURES, avatarAppearanceSchema } from './avatar.ts';
import { PARTICIPANT_COLOR_IDS } from './colors.ts';

export const MAX_NICK_LEN = 20;

export const profileLoginMessageSchema = z
  .object({
    type: z.literal('profile_login'),
    profileToken: z.string().max(64),
  })
  .strict();

export const joinMessageSchema = z.object({
  type: z.literal('join'),
  seq: z.number().int().nonnegative(),
  nick: z.string().trim().min(1).max(MAX_NICK_LEN),
  avatar: avatarAppearanceSchema.optional(),
  color: z.enum(PARTICIPANT_COLOR_IDS),
  profileId: z.string().min(1).max(64).optional(),
});

export const updateProfileMessageSchema = joinMessageSchema
  .omit({ profileId: true })
  .extend({ type: z.literal('update_profile') });

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
