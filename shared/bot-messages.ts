import { z } from 'zod';
import { avatarAppearanceSchema } from './avatar.ts';
import {
  BOT_NAME_MAX_LEN,
  EFFORT_LEVELS,
  PERSONALITY_PRESETS,
  personalityTextSchema,
} from './bot-tools.ts';
import { PARTICIPANT_COLOR_IDS } from './colors.ts';
import { hasTerminalControlCharacters } from './display-name.ts';
import { PLAY_STYLES } from './play-style.ts';
import { botModelSchema, HARNESS_IDS } from './storage-schemas.ts';

/** Client messages the host sends to manage bot slots in the lobby. */

export const botSlotPatchSchema = z.object({
  avatar: avatarAppearanceSchema.optional(),
  // Empty means "name the bot after its model".
  name: z
    .string()
    .trim()
    .max(BOT_NAME_MAX_LEN)
    .refine(
      (value) => !hasTerminalControlCharacters(value),
      'Имя не должно содержать управляющие символы',
    )
    .optional(),
  color: z.enum(PARTICIPANT_COLOR_IDS).optional(),
  enabled: z.boolean().optional(),
  harness: z.enum(HARNESS_IDS).optional(),
  model: botModelSchema.optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  moveLimit: z.number().int().min(0).max(20).optional(),
  imageSize: z.union([z.literal(256), z.literal(400), z.literal(640)]).optional(),
  budgetSec: z.number().int().min(60).max(600).optional(),
  playStyle: z.enum(PLAY_STYLES).optional(),
  /**
   * The eyes of a Detective: their own harness, and a model of that harness (the server picks the
   * harness's first model when it is left out). `null` puts the eyes back on the brain's model.
   */
  eyes: z
    .object({ harness: z.enum(HARNESS_IDS), model: botModelSchema.optional() })
    .strict()
    .nullable()
    .optional(),
  /** The effort the eyes of a Detective look at; the brain keeps `effort`. */
  eyesEffort: z.enum(EFFORT_LEVELS).optional(),
  personalityPreset: z.enum(PERSONALITY_PRESETS).optional(),
  personalityText: personalityTextSchema.optional(),
});

export const addBotMessageSchema = z.object({
  type: z.literal('add_bot'),
  seq: z.number().int().nonnegative(),
});

export const removeBotMessageSchema = z.object({
  type: z.literal('remove_bot'),
  seq: z.number().int().nonnegative(),
  botId: z.string().min(1).max(64),
});

export const updateBotMessageSchema = z.object({
  type: z.literal('update_bot'),
  seq: z.number().int().nonnegative(),
  botId: z.string().min(1).max(64),
  patch: botSlotPatchSchema,
});

export const applyBotPresetMessageSchema = z.object({
  type: z.literal('apply_bot_preset'),
  seq: z.number().int().nonnegative(),
  botId: z.string().min(1).max(64),
  preset: z.enum(['novice', 'amateur', 'master']),
});

export const checkBotVisionMessageSchema = z.object({
  type: z.literal('check_bot_vision'),
  seq: z.number().int().nonnegative(),
  botId: z.string().min(1).max(64),
});

export const resetBotWinsMessageSchema = z.object({
  type: z.literal('reset_bot_wins'),
  seq: z.number().int().nonnegative(),
  botId: z.string().min(1).max(64),
});
