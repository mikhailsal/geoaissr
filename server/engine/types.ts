import type {
  BotTurnThumbView,
  ClientViewState,
  HarnessCatalogEntry,
  LobbySummary,
  QuotaSummaryView,
  RoundResultEntryView,
  TunnelStatusView,
} from '../../shared/protocol.ts';
import type { AvatarAppearance } from '../../shared/avatar.ts';
import type { RoundCompletion } from '../../shared/round-timing.ts';
import type { LatLng } from '../../shared/score.ts';
import type { BotAccounting } from '../../shared/bot-results.ts';
import type { CurrentGuess, FindingState, JournalStep, Shift } from '../../shared/bot-journal.ts';
import type {
  BotRoundTelemetry,
  BotSlotConfig,
  MatchRecord,
  RegionId,
  SettingsFile,
} from '../../shared/storage-schemas.ts';

export interface PlayerState {
  avatar?: AvatarAppearance;
  profileId?: string;
  id: string;
  secret: string;
  name: string;
  color: BotSlotConfig['color'];
  isHost: boolean;
  connected: boolean;
  isSpectator: boolean;
  mapsError?: string;
  panoLoaded: boolean;
  totalScore: number;
  answeredRounds: number;
  totalDistanceKm: number;
}

export interface RoundTarget {
  panoId: string;
  lat: number;
  lng: number;
  countryId: string;
  countryNameRu: string;
  region: RegionId;
  fakeSceneIndex: number;
}

export interface HumanGuessState {
  pin: LatLng | null;
  confirmed: boolean;
  confirmedAt: number | null;
}

export interface BotGuessData {
  lat: number;
  lng: number;
  /** Mirrors `summary`; kept so older result views keep reading it. */
  explanation: string;
  /** First-person summary from `final_guess`; absent on checkpoints. */
  summary?: string;
  quip?: string;
}

export interface BotRoundState extends BotAccounting {
  guessFinalized?: boolean;
  slotId: string;
  name: string;
  color: BotSlotConfig['color'];
  harness: BotSlotConfig['harness'];
  model: string;
  moveLimit: number;
  turnsUsed: number;
  status: 'thinking' | 'done' | 'aborted';
  abortReason?: string;
  terminationReason: string;
  diagnosticsTail?: string;
  firstGuessAt: number | null;
  lastGuessAt: number | null;
  guess: BotGuessData | null;
  thumbs: BotTurnThumbView[];
  /** Step-by-step journal, built from thumbs, checkpoints and `bot_finding` events. */
  journal?: JournalStep[];
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ActiveRoundState {
  roundNumber: number;
  startedLoadingAt: number;
  startImagesReady: boolean;
  startImagesReadyAt: number | null;
  countdownStartsAt: number | null;
  prepError?: string;
  target: RoundTarget | null;
  roundStartedAt: number | null;
  roundDeadlineAt: number | null;
  endsAt: number | null;
  allHumansConfirmedAt: number | null;
  humanGuesses: Record<string, HumanGuessState>;
  bots: Record<string, BotRoundState>;
}

export interface RoundResultsState {
  completion: RoundCompletion;
  roundNumber: number;
  target: RoundTarget;
  entries: RoundResultEntryView[];
  humanVsAi: {
    visible: boolean;
    humansRound: number;
    aiRound: number;
    humansTotal: number;
    aiTotal: number;
  };
}

export interface RoundArchiveRecord {
  gen?: number;
  roundNumber: number;
  target: RoundTarget;
  humanWaitMs: number | null;
  entriesByParticipant: Record<string, RoundResultEntryView>;
  botTelemetry: BotRoundTelemetry[];
  humansMeanScore: number;
  aiMeanScore: number;
}

export interface RoomState {
  wins6h: { byProfileId: Record<string, number>; byBotId: Record<string, number> };
  matchId: string;
  gen: number;
  matchStartedAt: string | null;
  phase: ClientViewState['phase'];
  fakeMode: boolean;
  settings: SettingsFile;
  settingsNotice?: string;
  quotaWarning?: string;
  matchWriteError?: string;
  winsWarning?: string;
  quotaSummary: QuotaSummaryView;
  tunnel: TunnelStatusView;
  availableHarnesses: HarnessCatalogEntry[];
  players: Record<string, PlayerState>;
  playerOrder: string[];
  usedCountryIds: string[];
  roundNumber: number;
  loadingOrActive: ActiveRoundState | null;
  results: RoundResultsState | null;
  playedRounds: RoundArchiveRecord[];
  humanVsAiTotal: { humans: number; ai: number };
}

export type EngineEvent =
  | {
      type: 'player_join';
      avatar?: AvatarAppearance;
      profileId?: string;
      playerId: string;
      secret: string;
      name: string;
      color: BotSlotConfig['color'];
      isHost: boolean;
    }
  | {
      type: 'player_reconnect';
      playerId: string;
      isHost: boolean;
      profileId?: string;
      avatar?: AvatarAppearance;
    }
  | {
      type: 'player_reclaim_nick';
      profileId?: string;
      playerId: string;
      oldPlayerId: string;
      newSecret: string;
      isHost?: boolean;
    }
  | { type: 'player_disconnect'; playerId: string }
  | {
      type: 'update_profile';
      playerId: string;
      nick: string;
      color: BotSlotConfig['color'];
      avatar?: AvatarAppearance;
    }
  | { type: 'reset_bot_wins'; playerId: string; botId: string }
  | {
      type: 'client_error';
      playerId: string;
      source: 'maps_js' | 'pano' | 'map';
      code: string;
      message: string;
    }
  | {
      type: 'update_lobby';
      playerId: string;
      patch: Partial<
        Pick<
          SettingsFile,
          'rounds' | 'roundDurationSec' | 'moveEnabled' | 'region' | 'aiWaitWindowSec'
        >
      >;
    }
  | { type: 'add_bot'; playerId: string }
  | { type: 'remove_bot'; playerId: string; botId: string }
  | { type: 'update_bot'; playerId: string; botId: string; patch: Record<string, unknown> }
  | {
      type: 'apply_bot_preset';
      playerId: string;
      botId: string;
      preset: 'novice' | 'amateur' | 'master';
    }
  | {
      type: 'update_bot_vision_check';
      botId: string;
      check: NonNullable<BotSlotConfig['lastVisionCheck']>;
    }
  | { type: 'confirm_quota_reset'; playerId: string }
  | { type: 'quota_updated'; quotaSummary: QuotaSummaryView; quotaWarning?: string }
  | { type: 'tunnel_updated'; tunnel: TunnelStatusView }
  | { type: 'start_match'; playerId: string }
  | {
      type: 'round_prepared';
      matchId: string;
      gen: number;
      roundNumber: number;
      target: RoundTarget;
    }
  | { type: 'round_prep_failed'; matchId: string; gen: number; roundNumber: number; reason: string }
  | { type: 'retry_round'; playerId: string; gen: number }
  | { type: 'pano_loaded'; playerId: string; roundNumber: number }
  | { type: 'pano_load_timeout'; matchId: string; gen: number }
  | { type: 'countdown_done'; matchId: string; gen: number }
  | { type: 'set_pin'; playerId: string; roundNumber: number; lat: number; lng: number }
  | { type: 'submit_guess'; playerId: string; roundNumber: number; lat: number; lng: number }
  | {
      type: 'bot_turns_updated';
      matchId: string;
      gen: number;
      roundNumber: number;
      botId: string;
      turnsUsed: number;
    }
  | {
      type: 'bot_thumb_added';
      matchId: string;
      gen: number;
      roundNumber: number;
      botId: string;
      thumb: BotTurnThumbView;
    }
  | {
      /** Attaches a finding (or its absence) to the step with index `turn`. */
      type: 'bot_finding';
      matchId: string;
      gen: number;
      roundNumber: number;
      botId: string;
      turn: number;
      finding?: string;
      findingState: Extract<FindingState, 'recorded' | 'missing'>;
      pointMissing?: true;
      shifts?: Shift[];
      currentGuess?: CurrentGuess;
    }
  | {
      type: 'bot_guess_recorded';
      matchId: string;
      gen: number;
      roundNumber: number;
      botId: string;
      guess: BotGuessData;
      finalized?: boolean;
    }
  | {
      type: 'bot_accounting';
      matchId: string;
      gen: number;
      roundNumber: number;
      botId: string;
      accounting: BotAccounting;
    }
  | {
      type: 'bot_finished';
      matchId: string;
      gen: number;
      roundNumber: number;
      botId: string;
      aborted: boolean;
      reason: string;
      diagnosticsTail?: string;
    }
  | {
      type: 'deadline_tick';
      matchId: string;
      gen: number;
      kind: 'round' | 'wait' | 'bot_budget';
      botId?: string;
    }
  | { type: 'next_round'; playerId: string; roundNumber: number }
  | { type: 'end_match'; playerId: string }
  | { type: 'play_again'; playerId: string }
  | { type: 'bot_wins_reset_result'; botId: string; at: string; ok: boolean }
  | { type: 'match_write_result'; ok: boolean; error?: string; record?: MatchRecord };

export type EngineEffect =
  | { type: 'save_settings'; settings: SettingsFile }
  | { type: 'persist_bot_wins_reset'; botId: string; at: string }
  | { type: 'confirm_quota_reset' }
  | {
      type: 'prepare_round';
      matchId: string;
      gen: number;
      roundNumber: number;
      region: RegionId;
      excludeCountryIds: string[];
      withBots: boolean;
    }
  | { type: 'schedule_pano_timeout'; matchId: string; gen: number; atMs: number }
  | { type: 'schedule_countdown'; matchId: string; gen: number; atMs: number }
  | {
      type: 'start_bot_processes';
      matchId: string;
      gen: number;
      roundNumber: number;
      bots: BotSlotConfig[];
      moveEnabled: boolean;
    }
  | { type: 'release_bot_observe'; matchId: string; gen: number; roundNumber: number }
  /** The engine moved the round end earlier (all humans confirmed); bots see the new deadline. */
  | {
      type: 'set_bot_round_deadline';
      matchId: string;
      gen: number;
      roundNumber: number;
      atMs: number;
    }
  | {
      type: 'schedule_deadline';
      matchId: string;
      gen: number;
      kind: 'round' | 'wait' | 'bot_budget';
      atMs: number;
      botId?: string;
    }
  | { type: 'stop_bot_process'; matchId: string; gen: number; botId: string; reason: string }
  | { type: 'stop_all_bots'; reason: string }
  | { type: 'clear_round_images' }
  | { type: 'clear_thumbs' }
  | { type: 'append_match_record'; record: MatchRecord }
  | {
      type: 'log_round_end';
      roundNumber: number;
      totalRounds: number;
      target: RoundTarget;
      answeredNames: string[];
      abortedBots: Array<{ name: string; reason: string }>;
    };

export interface ReduceOutput {
  state: RoomState;
  effects: EngineEffect[];
  ack?: 'ok' | 'round_over' | 'already_confirmed' | 'not_in_round' | 'invalid' | 'forbidden';
}

export function createInitialRoomState(opts: {
  matchId: string;
  fakeMode: boolean;
  settings: SettingsFile;
  settingsNotice?: string;
  quotaWarning?: string;
  quotaSummary: QuotaSummaryView;
  tunnel: TunnelStatusView;
  availableHarnesses: HarnessCatalogEntry[];
}): RoomState {
  return {
    wins6h: {
      byProfileId: Object.create(null) as Record<string, number>,
      byBotId: Object.create(null) as Record<string, number>,
    },
    matchId: opts.matchId,
    gen: 1,
    matchStartedAt: null,
    phase: 'LOBBY',
    fakeMode: opts.fakeMode,
    settings: opts.settings,
    settingsNotice: opts.settingsNotice,
    quotaWarning: opts.quotaWarning,
    quotaSummary: opts.quotaSummary,
    tunnel: opts.tunnel,
    availableHarnesses: opts.availableHarnesses,
    players: {},
    playerOrder: [],
    usedCountryIds: [],
    roundNumber: 0,
    loadingOrActive: null,
    results: null,
    playedRounds: [],
    humanVsAiTotal: { humans: 0, ai: 0 },
  };
}

export function computeLobbySummary(state: RoomState): LobbySummary {
  const players = state.playerOrder
    .map((id) => state.players[id])
    .filter((p): p is PlayerState => Boolean(p));
  const humans = players.filter((p) => p.connected).map((p) => p.name);
  const disconnected = players.filter((p) => !p.connected).map((p) => p.name);
  const aiCount = state.settings.bots.filter((b) => b.enabled).length;
  const usedColors = [...players.map((p) => p.color), ...state.settings.bots.map((b) => b.color)];
  return {
    humans,
    aiCount,
    disconnected,
    phase: state.phase,
    roundNumber: state.roundNumber,
    totalRounds: state.settings.rounds,
    usedColors,
  };
}
