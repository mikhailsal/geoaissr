import { z } from 'zod';
import {
  BOT_NAME_MAX_LEN,
  DIFFICULTY_PRESETS,
  EFFORT_LEVELS,
  PERSONALITY_PRESETS,
  personalityTextSchema,
} from './bot-tools.ts';
import { PARTICIPANT_COLOR_IDS } from './colors.ts';
import {
  HARNESS_IDS,
  REGION_IDS,
  botSlotConfigSchema,
  type BotSlotConfig,
  type HarnessId,
  type RegionId,
} from './storage-schemas.ts';

export const MAX_WS_MESSAGE_BYTES = 16 * 1024;
export const MAX_NICK_LEN = 20;
export const MAX_HUMANS = 8;
export const MAX_BOTS = 3;
/** Pre-round countdown length; the client renders the live remainder from countdownStartsAt. */
export const COUNTDOWN_MS = 3_000;
export const MAX_WS_CONNECTIONS = 32;
export const MAX_PENDING_AUTH_CONNECTIONS = 8;
export const UNAUTH_TIMEOUT_MS = 5_000;
export const PANO_LOAD_TIMEOUT_MS = 5_000;

export type GamePhase = 'LOBBY' | 'ROUND_LOADING' | 'ROUND_ACTIVE' | 'ROUND_RESULTS' | 'FINAL';

export type AckResult =
  'ok' | 'round_over' | 'already_confirmed' | 'not_in_round' | 'invalid' | 'forbidden';

export const helloMessageSchema = z.object({
  type: z.literal('hello'),
  token: z.string().min(1).max(128),
  playerId: z.string().min(1).max(64).optional(),
  playerSecret: z.string().min(1).max(128).optional(),
});

export const joinMessageSchema = z.object({
  type: z.literal('join'),
  seq: z.number().int().nonnegative(),
  nick: z.string().trim().min(1).max(MAX_NICK_LEN),
  color: z.enum(PARTICIPANT_COLOR_IDS),
});

export const pingMessageSchema = z.object({
  type: z.literal('ping'),
  clientNow: z.number().finite(),
});

export const lobbySettingsPatchSchema = z.object({
  rounds: z.number().int().min(1).max(20).optional(),
  roundDurationSec: z.number().int().min(30).max(600).optional(),
  moveEnabled: z.boolean().optional(),
  region: z.enum(REGION_IDS).optional(),
  aiWaitWindowSec: z.number().int().min(0).max(120).optional(),
});

export const updateLobbyMessageSchema = z.object({
  type: z.literal('update_lobby'),
  seq: z.number().int().nonnegative(),
  patch: lobbySettingsPatchSchema,
});

export const botSlotPatchSchema = z.object({
  // Empty means "name the bot after its model".
  name: z
    .string()
    .trim()
    .max(BOT_NAME_MAX_LEN)
    .refine((v) => !/[\r\n]/.test(v), 'Имя должно быть в одну строку')
    .optional(),
  color: z.enum(PARTICIPANT_COLOR_IDS).optional(),
  enabled: z.boolean().optional(),
  harness: z.enum(HARNESS_IDS).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  moveLimit: z.number().int().min(0).max(20).optional(),
  imageSize: z.union([z.literal(256), z.literal(400), z.literal(640)]).optional(),
  budgetSec: z.number().int().min(60).max(600).optional(),
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

export const simpleSeqMessageSchema = z.object({
  type: z.enum(['confirm_quota_reset', 'start_match', 'end_match', 'play_again']),
  seq: z.number().int().nonnegative(),
});

export const panoLoadedMessageSchema = z.object({
  type: z.literal('pano_loaded'),
  seq: z.number().int().nonnegative(),
  roundNumber: z.number().int().positive(),
  countedLoad: z.boolean(),
});

export const mapLoadedMessageSchema = z.object({
  type: z.literal('map_loaded'),
  seq: z.number().int().nonnegative(),
  kind: z.enum(['guess', 'results']),
});

export const clientErrorMessageSchema = z.object({
  type: z.literal('client_error'),
  seq: z.number().int().nonnegative(),
  source: z.enum(['maps_js', 'pano', 'map']),
  code: z.string().max(120),
  message: z.string().max(400),
});

export const setPinMessageSchema = z.object({
  type: z.literal('set_pin'),
  seq: z.number().int().nonnegative(),
  roundNumber: z.number().int().positive(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite(),
});

export const submitGuessMessageSchema = z.object({
  type: z.literal('submit_guess'),
  seq: z.number().int().nonnegative(),
  roundNumber: z.number().int().positive(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite(),
});

export const nextRoundMessageSchema = z.object({
  type: z.literal('next_round'),
  seq: z.number().int().nonnegative(),
  roundNumber: z.number().int().positive(),
});

export const retryRoundMessageSchema = z.object({
  type: z.literal('retry_round'),
  seq: z.number().int().nonnegative(),
  gen: z.number().int().nonnegative(),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  helloMessageSchema,
  joinMessageSchema,
  pingMessageSchema,
  updateLobbyMessageSchema,
  addBotMessageSchema,
  removeBotMessageSchema,
  updateBotMessageSchema,
  applyBotPresetMessageSchema,
  checkBotVisionMessageSchema,
  simpleSeqMessageSchema,
  panoLoadedMessageSchema,
  mapLoadedMessageSchema,
  clientErrorMessageSchema,
  setPinMessageSchema,
  submitGuessMessageSchema,
  nextRoundMessageSchema,
  retryRoundMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface HarnessCatalogEntry {
  id: HarnessId;
  available: boolean;
  reason?: string;
  fixCommand?: string;
  readsOwnerFiles: boolean;
  versionWarning?: string;
  models: string[];
}

export interface LobbySummary {
  humans: string[];
  aiCount: number;
  disconnected: string[];
  phase: GamePhase;
  roundNumber: number;
  totalRounds: number;
  usedColors: (typeof PARTICIPANT_COLOR_IDS)[number][];
}

export interface PlayerView {
  id: string;
  name: string;
  color: (typeof PARTICIPANT_COLOR_IDS)[number];
  isHost: boolean;
  connected: boolean;
  isSpectator: boolean;
  mapsError?: string;
  panoLoaded: boolean;
  hasPin: boolean;
  confirmed: boolean;
  totalScore: number;
  answeredRounds: number;
  totalDistanceKm: number;
}

export interface BotRoundProgressView {
  id: string;
  name: string;
  color: (typeof PARTICIPANT_COLOR_IDS)[number];
  turnsUsed: number;
  moveLimit: number;
  status: 'thinking' | 'done' | 'aborted';
  abortReason?: string;
}

export interface BotTurnThumbView {
  turn: number;
  action: 'observe' | 'look' | 'move';
  label: string;
  thumbUrl: string;
  fullUrl?: string;
}

export interface RoundResultEntryView {
  id: string;
  name: string;
  color: (typeof PARTICIPANT_COLOR_IDS)[number];
  isAi: boolean;
  rank: number;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  roundScore: number;
  totalScore: number;
  explanation?: string;
  quip?: string;
  turnsUsed?: number;
  elapsedMs?: number;
  terminationReason?: string;
  diagnosticsTail?: string;
  thumbs: BotTurnThumbView[];
}

export interface QuotaMetricView {
  used: number;
  ceiling: number;
  percent: number;
  dailyAvg: number | null;
  projectedMonth: number | null;
  status: 'ok' | 'warn' | 'danger';
}

export interface QuotaSummaryView {
  metrics: {
    static: QuotaMetricView;
    pano: QuotaMetricView;
    map: QuotaMetricView;
  };
  staticUsed: number;
  staticCeiling: number;
  staticWorstCase: number;
  panoUsed: number;
  panoCeiling: number;
  panoWorstCase: number;
  mapUsed: number;
  mapCeiling: number;
  mapWorstCase: number;
  needsResetConfirm: boolean;
  resetReason?: string;
  sufficient: boolean;
  exceedsMessage?: string;
}

export interface TunnelStatusView {
  mode: 'tunnel' | 'local' | 'public_url';
  status: 'checking' | 'ready' | 'error' | 'local';
  inviteUrl: string | null;
  errorReason?: string;
  changedSinceStart: boolean;
}

export interface ClientViewState {
  matchId: string;
  gen: number;
  phase: GamePhase;
  viewerId: string;
  viewerIsHost: boolean;
  viewerIsSpectator: boolean;
  hostConnected: boolean;
  fakeMode: boolean;
  roundNumber: number;
  totalRounds: number;
  roundDurationSec: number;
  moveEnabled: boolean;
  region: RegionId;
  aiWaitWindowSec: number;
  startBlockedReasons: string[];
  settingsNotice?: string;
  quotaWarning?: string;
  matchWriteError?: string;
  tunnel: TunnelStatusView;
  quota: QuotaSummaryView;
  players: PlayerView[];
  bots: BotSlotConfig[];
  availableHarnesses: HarnessCatalogEntry[];
  loading?: {
    waitingFor: string[];
    countdownStartsAt: number | null;
    countdownSeconds: number | null;
    prepError?: string;
    panoId?: string;
    fakeSceneIndex?: number;
  };
  active?: {
    panoId: string;
    fakeSceneIndex: number;
    endsAt: number;
    allHumansConfirmed: boolean;
    myPin: { lat: number; lng: number } | null;
    myConfirmed: boolean;
    confirmedCount: number;
    playingHumanCount: number;
    botProgress: BotRoundProgressView[];
  };
  results?: {
    targetLat: number;
    targetLng: number;
    countryNameRu: string;
    entries: RoundResultEntryView[];
    humanVsAi: {
      visible: boolean;
      humansRound: number;
      aiRound: number;
      humansTotal: number;
      aiTotal: number;
    };
  };
  final?: {
    playedRounds: number;
    plannedRounds: number;
    standings: {
      id: string;
      name: string;
      color: (typeof PARTICIPANT_COLOR_IDS)[number];
      isAi: boolean;
      rank: number;
      totalScore: number;
      answeredRounds: number;
      perRound: {
        roundNumber: number;
        played: boolean;
        score: number | null;
        distanceKm: number | null;
        botCard?: RoundResultEntryView;
      }[];
    }[];
    humanVsAi: { visible: boolean; humansTotal: number; aiTotal: number };
  };
}

export type ServerMessage =
  | {
      type: 'hello_ok';
      serverNow: number;
      role: 'host' | 'guest';
      browserMapsKey: string | null;
      fakeMode: boolean;
      restoredPlayerId?: string;
      lobbySummary: LobbySummary;
    }
  | {
      type: 'hello_error';
      serverNow: number;
      code: 'invalid_token' | 'room_full' | 'replaced_by_new_tab' | 'unauth_timeout';
      message: string;
    }
  | {
      type: 'join_ok';
      serverNow: number;
      playerId: string;
      playerSecret: string;
    }
  | {
      type: 'join_error';
      serverNow: number;
      seq: number;
      code: 'nick_taken' | 'color_taken' | 'room_full' | 'bad_nick';
      message: string;
      lobbySummary: LobbySummary;
    }
  | {
      type: 'pong';
      serverNow: number;
      clientNow: number;
    }
  | {
      type: 'ack';
      serverNow: number;
      seq: number;
      result: AckResult;
      message?: string;
    }
  | {
      type: 'vision_check_result';
      serverNow: number;
      botId: string;
      passed: boolean;
      elapsedMs: number;
      message: string;
    }
  | {
      type: 'state';
      serverNow: number;
      version: number;
      view: ClientViewState;
    };

export { DIFFICULTY_PRESETS, HARNESS_IDS, botSlotConfigSchema };
