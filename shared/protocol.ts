import { z } from 'zod';
import { updateAudioPreferencesMessageSchema } from './audio-preferences.ts';
import type { AvatarGesture, AvatarAppearance } from './avatar.ts';
import {
  helloMessageSchema,
  joinMessageSchema,
  profileLoginMessageSchema,
  updateProfileMessageSchema,
  releaseGuestSeatMessageSchema,
  avatarGestureMessageSchema,
  avatarSpinMessageSchema,
  avatarTurnMessageSchema,
} from './profile-messages.ts';
import {
  addBotMessageSchema,
  applyBotPresetMessageSchema,
  checkBotVisionMessageSchema,
  removeBotMessageSchema,
  resetBotWinsMessageSchema,
  updateBotMessageSchema,
} from './bot-messages.ts';
import { DIFFICULTY_PRESETS } from './bot-tools.ts';
import type { PARTICIPANT_COLOR_IDS } from './colors.ts';
import type { PlayStyle } from './play-style.ts';
import type { BotAccounting, BotReasoning, BotTurnThumbView } from './bot-results.ts';
import type { BotJournal } from './bot-journal.ts';
export type { BotTurnThumbView } from './bot-results.ts';
import {
  type StoredProfile,
  HARNESS_IDS,
  REGION_IDS,
  botSlotConfigSchema,
  type BotSlotConfig,
  type HarnessId,
  type RegionId,
} from './storage-schemas.ts';
import type { RoundCompletion } from './round-timing.ts';

export { DIFFICULTY_PRESETS, HARNESS_IDS, botSlotConfigSchema };
export {
  helloMessageSchema,
  joinMessageSchema,
  profileLoginMessageSchema,
  updateProfileMessageSchema,
  releaseGuestSeatMessageSchema,
};
export { MAX_NICK_LEN } from './profile-messages.ts';
export {
  addBotMessageSchema,
  applyBotPresetMessageSchema,
  botSlotPatchSchema,
  checkBotVisionMessageSchema,
  removeBotMessageSchema,
  resetBotWinsMessageSchema,
  updateBotMessageSchema,
} from './bot-messages.ts';
export { ROUND_INTRO_MS, COUNTDOWN_MS, PANO_LOAD_TIMEOUT_MS } from './round-timing.ts';
export const MAX_WS_MESSAGE_BYTES = 16 * 1024;

export const MAX_HUMANS = 8;
export const MAX_BOTS = 3;
export const MAX_WS_CONNECTIONS = 32;
export const MAX_PENDING_AUTH_CONNECTIONS = 8;
export const UNAUTH_TIMEOUT_MS = 5_000;
/** Lobby seats held for a briefly disconnected guest are never retained indefinitely. */
export const DISCONNECTED_GUEST_GRACE_MS = 10 * 60 * 1_000;

export type GamePhase = 'LOBBY' | 'ROUND_LOADING' | 'ROUND_ACTIVE' | 'ROUND_RESULTS' | 'FINAL';
export type AckResult =
  | 'ok'
  | 'round_over'
  | 'already_confirmed'
  | 'not_in_round'
  | 'invalid'
  | 'forbidden'
  | 'rate_limited';

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
  showMatchStandings: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  allowBotPush: z.boolean().optional(),
});

export type LobbySettingsPatch = z.infer<typeof lobbySettingsPatchSchema>;

export const updateLobbyMessageSchema = z.object({
  type: z.literal('update_lobby'),
  seq: z.number().int().nonnegative(),
  patch: lobbySettingsPatchSchema,
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
  profileLoginMessageSchema,
  joinMessageSchema,
  updateProfileMessageSchema,
  avatarGestureMessageSchema,
  avatarSpinMessageSchema,
  avatarTurnMessageSchema,
  releaseGuestSeatMessageSchema,
  updateAudioPreferencesMessageSchema,
  resetBotWinsMessageSchema,
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
  avatar?: AvatarAppearance;
  wins6h: number;
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
  wins6h: number;
  id: string;
  name: string;
  color: (typeof PARTICIPANT_COLOR_IDS)[number];
  turnsUsed: number;
  moveLimit: number;
  status: 'thinking' | 'done' | 'aborted';
  abortReason?: string;
  /** The style the bot really plays this round; absent means Intuit. */
  playStyle?: PlayStyle;
}

export interface RoundResultEntryView extends BotReasoning, BotAccounting {
  journal?: BotJournal;
  usedDraft?: boolean;
  wins6h: number;
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

export type BotSlotLobbyView = BotSlotConfig & { wins6h: number };
export interface FinalEntryView {
  id: string;
  name: string;
  color: (typeof PARTICIPANT_COLOR_IDS)[number];
  isAi: boolean;
  rank: number;
  totalScore: number;
  answeredRounds: number;
  wins6h: number;
  perRound: {
    roundNumber: number;
    played: boolean;
    score: number | null;
    distanceKm: number | null;
    botCard?: RoundResultEntryView;
  }[];
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
  showMatchStandings: boolean;
  pushEnabled: boolean;
  allowBotPush: boolean;
  startBlockedReasons: string[];
  settingsNotice?: string;
  quotaWarning?: string;
  matchWriteError?: string;
  winsWarning?: string;
  tunnel: TunnelStatusView;
  quota: QuotaSummaryView;
  players: PlayerView[];
  bots: BotSlotLobbyView[];
  availableHarnesses: HarnessCatalogEntry[];
  loading?: {
    waitingFor: string[];
    /** Server timestamp at which round loading began. */
    startedLoadingAt: number;
    /** Server timestamp at which the countdown begins, which can be in the future. */
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
    completion?: RoundCompletion;
    targetLat: number;
    targetLng: number;
    countryNameRu: string;
    entries: RoundResultEntryView[];
    matchStandings?: {
      id: string;
      name: string;
      rank: number;
      totalScore: number;
    }[];
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
    standings: FinalEntryView[];
    humanVsAi: { visible: boolean; humansTotal: number; aiTotal: number };
  };
}

export interface ProfileLoginOk {
  type: 'profile_login_ok';
  serverNow: number;
  profile: StoredProfile;
  playerId: string;
  playerSecret: string;
  resumedSeat: boolean;
  browserMapsKey: string | null;
  fakeMode: boolean;
  lobbySummary: LobbySummary;
}
export interface ProfileLoginError {
  type: 'profile_login_error';
  serverNow: number;
  code: 'invalid_profile_token' | 'room_full' | 'profile_store_unavailable' | 'host_required';
  message: string;
}
export type ServerMessage =
  | ProfileLoginOk
  | ProfileLoginError
  | { type: 'avatar_turn'; serverNow: number; participantId: string; yaw: number }
  | { type: 'avatar_gesture'; serverNow: number; participantId: string; gesture: AvatarGesture }
  | {
      type: 'hello_ok';
      profile?: StoredProfile;
      serverNow: number;
      role: 'host' | 'guest';
      browserMapsKey: string | null;
      fakeMode: boolean;
      restoredPlayerId?: string;
      restoredProfileId?: string;
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
      profile: StoredProfile;
      serverNow: number;
      playerId: string;
      playerSecret: string;
    }
  | {
      type: 'join_error';
      serverNow: number;
      seq: number;
      code:
        | 'nick_taken'
        | 'color_taken'
        | 'room_full'
        | 'bad_nick'
        | 'profile_token_required'
        | 'profile_store_unavailable';
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
      retryAfterMs?: number;
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
