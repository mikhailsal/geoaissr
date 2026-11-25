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
import { MAP_IDS } from './maps.ts';
import { PLAY_STYLES } from './play-style.ts';
import { regionIdSchema } from './region-ids.ts';

export { AREA_REGION_IDS, type AreaRegionId, type RegionId } from './region-ids.ts';

export const HARNESS_IDS = ['codex', 'claude', 'agy'] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

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

export const botModelSchema = z.string().trim().min(1).max(120);

/** The CLI and the model of one process, for the eyes of a Detective that differ from the brain. */
export const roleModelSchema = z.object({
  harness: z.enum(HARNESS_IDS),
  model: botModelSchema,
});

/** Bot ids become directory names under the run dir, so only path-safe characters are allowed. */
export const botSlotIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const botSlotConfigSchema = z.object({
  avatar: avatarAppearanceSchema.optional(),
  id: botSlotIdSchema,
  name: z.string().trim().min(1).max(BOT_NAME_MAX_LEN),
  color: z.enum(PARTICIPANT_COLOR_IDS),
  enabled: z.boolean(),
  harness: z.enum(HARNESS_IDS),
  model: botModelSchema,
  effort: z.enum(EFFORT_LEVELS),
  moveLimit: z.number().int().min(0).max(20),
  imageSize: z.union([z.literal(256), z.literal(400), z.literal(640)]),
  budgetSec: z.number().int().min(60).max(600),
  /** Absent in settings saved before the Detective style existed: those bots play Intuit. */
  playStyle: z.enum(PLAY_STYLES).optional(),
  /** Detective only: where the eyes run. Absent means on the brain's harness and model. */
  eyes: roleModelSchema.optional(),
  /** Detective only: the effort the eyes look at. Absent means low (`EYES_EFFORT`). */
  eyesEffort: z.enum(EFFORT_LEVELS).optional(),
  difficultyPreset: z.enum(DIFFICULTY_PRESETS),
  personalityPreset: z.enum(PERSONALITY_PRESETS),
  personalityText: personalityTextSchema,
  disabledReason: z.string().optional(),
  lastVisionCheck: visionCheckRecordSchema.optional(),
  winResetAt: z.string().optional(),
});

export type BotSlotConfig = z.infer<typeof botSlotConfigSchema>;

/** Version of `settings.json`. Version 2 split the map from the region. */
export const SETTINGS_FILE_VERSION = 2;

export const settingsFileSchema = z.object({
  version: z.literal(SETTINGS_FILE_VERSION),
  rounds: z.number().int().min(1).max(20),
  roundDurationSec: z.number().int().min(30).max(600),
  moveEnabled: z.boolean(),
  /** The pool of places a round can start in. */
  map: z.enum(MAP_IDS),
  /** Narrows the map to the world, a continent or one country. */
  region: regionIdSchema,
  aiWaitWindowSec: z.number().int().min(0).max(120),
  /** Absent in older settings files: show standings after each completed round. */
  showMatchStandings: z.boolean().default(true),
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
    version: SETTINGS_FILE_VERSION,
    rounds: 5,
    roundDurationSec: 120,
    moveEnabled: true,
    map: 'standard',
    region: 'world',
    aiWaitWindowSec: 20,
    showMatchStandings: true,
    bots: [],
  };
}

/**
 * Version 1 kept the airports map among the regions. Used for the settings file and for match
 * records: both stored `region` the same way.
 */
export function splitLegacyRegion(region: unknown): { map: string; region: unknown } {
  return region === 'airports' ? { map: 'airports', region: 'world' } : { map: 'standard', region };
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

/** Version of a line in `matches.jsonl`. Version 2 added the map. */
export const MATCH_RECORD_VERSION = 2;

/** A version 1 line had no map: the airports map was stored as its region. */
function upgradeLegacyMatchRecord(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('version' in raw) || raw.version !== 1) {
    return raw;
  }
  const legacy = raw as Record<string, unknown>;
  return { ...legacy, ...splitLegacyRegion(legacy.region), version: MATCH_RECORD_VERSION };
}

const currentMatchRecordSchema = z.object({
  version: z.literal(MATCH_RECORD_VERSION),
  matchId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  map: z.enum(MAP_IDS),
  region: regionIdSchema,
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

/** Reads a line of any supported version and gives it back in the current one. */
export const matchRecordSchema = z.preprocess(upgradeLegacyMatchRecord, currentMatchRecordSchema);

export type MatchRecord = z.infer<typeof currentMatchRecordSchema>;

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
