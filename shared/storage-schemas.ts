import { avatarAppearanceSchema } from './avatar.ts';
import { z } from 'zod';
import { audioPreferencesSchema } from './audio-preferences.ts';
import {
  BOT_NAME_MAX_LEN,
  DIFFICULTY_PRESETS,
  EFFORT_LEVELS,
  IMAGE_SIZES,
  PERSONALITY_PRESETS,
  personalityTextSchema,
} from './bot-tools.ts';
import { PARTICIPANT_COLOR_IDS } from './colors.ts';
import { PLAY_STYLES } from './play-style.ts';

export const HARNESS_IDS = ['codex', 'claude', 'agy'] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const REGION_IDS = [
  'world',
  'europe',
  'asia',
  'north_america',
  'south_america',
  'africa',
  'oceania',
] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const visionCheckRecordSchema = z.object({
  passed: z.boolean(),
  elapsedMs: z.number().int().nonnegative(),
  model: z.string(),
  effort: z.enum(EFFORT_LEVELS),
  imageSize: z.union([z.literal(256), z.literal(400), z.literal(640)]),
  error: z.string().optional(),
  checkedAt: z.string(),
});

export type VisionCheckRecord = z.infer<typeof visionCheckRecordSchema>;

/** Bot ids become directory names under the run dir, so only path-safe characters are allowed. */
export const botSlotIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const botSlotConfigSchema = z.object({
  avatar: avatarAppearanceSchema.optional(),
  id: botSlotIdSchema,
  name: z.string().trim().min(1).max(BOT_NAME_MAX_LEN),
  color: z.enum(PARTICIPANT_COLOR_IDS),
  enabled: z.boolean(),
  harness: z.enum(HARNESS_IDS),
  model: z.string().trim().min(1).max(120),
  effort: z.enum(EFFORT_LEVELS),
  moveLimit: z.number().int().min(0).max(20),
  imageSize: z.union([z.literal(256), z.literal(400), z.literal(640)]),
  budgetSec: z.number().int().min(60).max(600),
  /** Absent in settings saved before the Detective style existed: those bots play Intuit. */
  playStyle: z.enum(PLAY_STYLES).optional(),
  difficultyPreset: z.enum(DIFFICULTY_PRESETS),
  personalityPreset: z.enum(PERSONALITY_PRESETS),
  personalityText: personalityTextSchema,
  disabledReason: z.string().optional(),
  lastVisionCheck: visionCheckRecordSchema.optional(),
  winResetAt: z.string().optional(),
});

export type BotSlotConfig = z.infer<typeof botSlotConfigSchema>;

export const settingsFileSchema = z.object({
  version: z.literal(1),
  rounds: z.number().int().min(1).max(20),
  roundDurationSec: z.number().int().min(30).max(600),
  moveEnabled: z.boolean(),
  region: z.enum(REGION_IDS),
  aiWaitWindowSec: z.number().int().min(0).max(120),
  bots: z.array(botSlotConfigSchema).max(3),
  quotaCeilings: z
    .object({
      staticRequests: z.number().int().positive().optional(),
      panoLoads: z.number().int().positive().optional(),
      mapLoads: z.number().int().positive().optional(),
    })
    .optional(),
});

export type SettingsFile = z.infer<typeof settingsFileSchema>;

export function createDefaultSettings(): SettingsFile {
  return {
    version: 1,
    rounds: 5,
    roundDurationSec: 120,
    moveEnabled: true,
    region: 'world',
    aiWaitWindowSec: 20,
    bots: [],
  };
}

export const quotaFileSchema = z.object({
  version: z.literal(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  staticRequests: z.number().int().nonnegative(),
  panoLoads: z.number().int().nonnegative(),
  mapLoads: z.number().int().nonnegative(),
  daily: z
    .record(
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      z.object({
        staticRequests: z.number().int().nonnegative(),
        panoLoads: z.number().int().nonnegative(),
        mapLoads: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});

export type QuotaFile = z.infer<typeof quotaFileSchema>;

export const botRoundTelemetrySchema = z.object({
  botId: z.string(),
  name: z.string(),
  harness: z.enum(HARNESS_IDS),
  model: z.string(),
  hadGuessBeforeStop: z.boolean(),
  timeToFirstGuessMs: z.number().int().nonnegative().nullable(),
  timeToLastGuessMs: z.number().int().nonnegative().nullable(),
  turnsUsed: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
  distanceKm: z.number().nonnegative().nullable(),
  terminationReason: z.string(),
});

export type BotRoundTelemetry = z.infer<typeof botRoundTelemetrySchema>;

export const matchRoundRecordSchema = z.object({
  roundNumber: z.number().int().positive(),
  targetLat: z.number(),
  targetLng: z.number(),
  countryNameRu: z.string(),
  humanWaitMs: z.number().int().nonnegative().nullable(),
  bots: z.array(botRoundTelemetrySchema),
});

export const matchParticipantSummarySchema = z.object({
  profileId: z.string().optional(),
  id: z.string(),
  name: z.string(),
  isAi: z.boolean(),
  color: z.enum(PARTICIPANT_COLOR_IDS),
  totalScore: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
  answeredRounds: z.number().int().nonnegative(),
  totalDistanceKm: z.number().nonnegative(),
});

export const matchRecordSchema = z.object({
  version: z.literal(1),
  matchId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  region: z.enum(REGION_IDS),
  plannedRounds: z.number().int().positive(),
  playedRounds: z.number().int().nonnegative(),
  moveEnabled: z.boolean(),
  participants: z.array(matchParticipantSummarySchema),
  humanVsAi: z.object({
    visible: z.boolean(),
    humansTotal: z.number().int().nonnegative(),
    aiTotal: z.number().int().nonnegative(),
  }),
  rounds: z.array(matchRoundRecordSchema),
});

export type MatchRecord = z.infer<typeof matchRecordSchema>;

export const harnessVerifiedEntrySchema = z.object({
  cliVersion: z.string(),
  verifiedAt: z.string(),
  deliveryMode: z.enum(['mcp', 'file']),
});

export const harnessVerifiedFileSchema = z.object({
  version: z.literal(1),
  harnesses: z
    .object({
      codex: harnessVerifiedEntrySchema,
      claude: harnessVerifiedEntrySchema,
      agy: harnessVerifiedEntrySchema,
    })
    .partial(),
});

export type HarnessVerifiedFile = z.infer<typeof harnessVerifiedFileSchema>;

export function isValidImageSize(val: number): val is (typeof IMAGE_SIZES)[number] {
  return (IMAGE_SIZES as readonly number[]).includes(val);
}

export const storedProfileSchema = z.object({
  avatar: avatarAppearanceSchema.optional(),
  profileId: z.string().min(1).max(64),
  profileToken: z.string().regex(/^[0-9a-f]{32}$/),
  nick: z.string().trim().min(1).max(20),
  color: z.enum(PARTICIPANT_COLOR_IDS),
  role: z.enum(['host', 'guest']),
  audioPreferences: audioPreferencesSchema.optional(),
});
export type StoredProfile = z.infer<typeof storedProfileSchema>;
export type ProfileRole = StoredProfile['role'];
export const profilesFileSchema = z
  .object({
    version: z.literal(1),
    profiles: z.array(storedProfileSchema),
  })
  .superRefine((file, ctx) => {
    for (const field of ['profileId', 'profileToken'] as const) {
      if (new Set(file.profiles.map((p) => p[field])).size !== file.profiles.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate profile identity' });
      }
    }
  });
export type ProfilesFile = z.infer<typeof profilesFileSchema>;
