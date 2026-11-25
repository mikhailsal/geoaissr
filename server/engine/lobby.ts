import { botNameFromModel, PRESET_CONFIGS, type DifficultyPreset } from '../../shared/bot-tools.ts';
import { avatarAppearanceSchema, type AvatarAppearance } from '../../shared/avatar.ts';
import { pickFirstFreeColor } from '../../shared/colors.ts';
import {
  MAX_BOTS,
  type HarnessCatalogEntry,
  type LobbySettingsPatch,
} from '../../shared/protocol.ts';
import { isKnownRegion } from '../../shared/regions.ts';
import type { BotSlotConfig, HarnessId, SettingsFile } from '../../shared/storage-schemas.ts';
import { eyesPatchInvalid, keepVisionCheck, mergeBotSlotPatch } from './bot-slot-patch.ts';
import type { PlayerState, ReduceOutput, RoomState } from './types.ts';

let botSeqCounter = 0;

function pickHarnessDefaults(availableHarnesses: readonly HarnessCatalogEntry[]): {
  harness: HarnessId;
  model: string;
  enabled: boolean;
  disabledReason?: string;
} {
  const usable = availableHarnesses.find((h) => h.available);
  if (usable) {
    return {
      harness: usable.id,
      model:
        usable.models[0] ??
        (usable.id === 'claude'
          ? 'claude-haiku-5-5'
          : usable.id === 'codex'
            ? 'gpt-6-luna'
            : 'gemini-3.8-flash-low'),
      enabled: true,
    };
  }
  const first = availableHarnesses[0];
  return {
    harness: first?.id ?? 'claude',
    model: first?.models[0] ?? 'claude-haiku-5-5',
    enabled: false,
    disabledReason: first?.reason ?? 'нет доступных харнессов',
  };
}

function getAllUsedColors(state: RoomState): BotSlotConfig['color'][] {
  const playerColors = state.playerOrder
    .map((id) => state.players[id]?.color)
    .filter((c): c is BotSlotConfig['color'] => Boolean(c));
  const botColors = state.settings.bots.map((b) => b.color);
  return [...playerColors, ...botColors];
}

function enforceMinRoundWithBots(settings: SettingsFile): {
  settings: SettingsFile;
  notice?: string;
} {
  const hasEnabledBot = settings.bots.some((b) => b.enabled);
  if (!hasEnabledBot || settings.roundDurationSec >= 60) {
    return { settings };
  }
  return {
    settings: { ...settings, roundDurationSec: 60 },
    notice: 'Длительность раунда поднята до 60 с: минимальное время при игре с ИИ',
  };
}

export function handleUpdateLobby(
  state: RoomState,
  playerId: string,
  patch: LobbySettingsPatch,
): ReduceOutput {
  if (state.phase !== 'LOBBY') return { state, effects: [], ack: 'forbidden' };
  const player = state.players[playerId];
  if (!player?.isHost) return { state, effects: [], ack: 'forbidden' };

  const hasEnabledBot = state.settings.bots.some((b) => b.enabled);
  let requestedDuration = patch.roundDurationSec ?? state.settings.roundDurationSec;
  // One patch can be corrected twice; the host reads about both.
  const notices: string[] = [];
  if (hasEnabledBot && requestedDuration < 60) {
    requestedDuration = 60;
    notices.push('Длительность раунда не может быть меньше 60 с при включённых ИИ');
  }

  // A country this build does not know (a stale client, a forged message) keeps the old region.
  let region = state.settings.region;
  if (patch.region !== undefined) {
    if (isKnownRegion(patch.region)) region = patch.region;
    else notices.push('Такого региона нет в этой версии игры. Обновите страницу');
  }
  const nextSettings: SettingsFile = {
    ...state.settings,
    ...patch,
    region,
    roundDurationSec: requestedDuration,
  };
  return {
    state: { ...state, settings: nextSettings, settingsNotice: notices.join('. ') || undefined },
    effects: [{ type: 'save_settings', settings: nextSettings }],
    ack: 'ok',
  };
}

export function handleAddBot(state: RoomState, playerId: string): ReduceOutput {
  if (state.phase !== 'LOBBY' || !state.players[playerId]?.isHost) {
    return { state, effects: [], ack: 'forbidden' };
  }
  if (state.settings.bots.length >= MAX_BOTS) {
    return { state, effects: [], ack: 'invalid' };
  }

  const used = getAllUsedColors(state);
  const color = pickFirstFreeColor(used) ?? 'p-12';
  const def = pickHarnessDefaults(state.availableHarnesses);
  const preset = PRESET_CONFIGS.amateur;
  const newBot: BotSlotConfig = {
    id: `bot-${Date.now().toString(36)}-${++botSeqCounter}`,
    name: botNameFromModel(def.model),
    color,
    enabled: def.enabled,
    harness: def.harness,
    model: def.model,
    effort: preset.effort,
    moveLimit: preset.moveLimit,
    imageSize: preset.imageSize,
    budgetSec: Math.max(60, state.settings.roundDurationSec),
    difficultyPreset: 'amateur',
    personalityPreset: 'neutral',
    personalityText: '',
    disabledReason: def.disabledReason,
  };

  const rawSettings: SettingsFile = {
    ...state.settings,
    bots: [...state.settings.bots, newBot],
  };
  const { settings, notice } = enforceMinRoundWithBots(rawSettings);
  return {
    state: { ...state, settings, settingsNotice: notice },
    effects: [{ type: 'save_settings', settings }],
    ack: 'ok',
  };
}

export function handleRemoveBot(state: RoomState, playerId: string, botId: string): ReduceOutput {
  if (state.phase !== 'LOBBY' || !state.players[playerId]?.isHost) {
    return { state, effects: [], ack: 'forbidden' };
  }
  const bots = state.settings.bots.filter((b) => b.id !== botId);
  if (bots.length === state.settings.bots.length) {
    return { state, effects: [], ack: 'invalid' };
  }
  const settings: SettingsFile = { ...state.settings, bots };
  return {
    state: { ...state, settings, settingsNotice: undefined },
    effects: [{ type: 'save_settings', settings }],
    ack: 'ok',
  };
}

export function handleUpdateBot(
  state: RoomState,
  playerId: string,
  botId: string,
  patch: Record<string, unknown>,
): ReduceOutput {
  if (state.phase !== 'LOBBY' || !state.players[playerId]?.isHost) {
    return { state, effects: [], ack: 'forbidden' };
  }
  const idx = state.settings.bots.findIndex((b) => b.id === botId);
  const existingBot = idx >= 0 ? state.settings.bots[idx] : undefined;
  if (!existingBot) return { state, effects: [], ack: 'invalid' };
  const appearance =
    patch.avatar === undefined ? undefined : avatarAppearanceSchema.safeParse(patch.avatar);
  if (appearance && !appearance.success) return { state, effects: [], ack: 'invalid' };
  if (eyesPatchInvalid(existingBot, patch, state.availableHarnesses)) {
    return { state, effects: [], ack: 'invalid' };
  }
  const updated = mergeBotSlotPatch(existingBot, patch, state.availableHarnesses);
  if (appearance) updated.avatar = appearance.data;
  const bots = state.settings.bots.map((b, i) => (i === idx ? updated : b));
  const { settings, notice } = enforceMinRoundWithBots({ ...state.settings, bots });
  return {
    state: { ...state, settings, settingsNotice: notice },
    effects: [{ type: 'save_settings', settings }],
    ack: 'ok',
  };
}

export function handleApplyBotPreset(
  state: RoomState,
  playerId: string,
  botId: string,
  preset: Exclude<DifficultyPreset, 'custom'>,
): ReduceOutput {
  if (state.phase !== 'LOBBY' || !state.players[playerId]?.isHost) {
    return { state, effects: [], ack: 'forbidden' };
  }
  const idx = state.settings.bots.findIndex((b) => b.id === botId);
  const cur = idx >= 0 ? state.settings.bots[idx] : undefined;
  if (!cur) return { state, effects: [], ack: 'invalid' };
  const cfg = PRESET_CONFIGS[preset];
  const tuned: BotSlotConfig = {
    ...cur,
    imageSize: cfg.imageSize,
    moveLimit: cfg.moveLimit,
    effort: cfg.effort,
    difficultyPreset: preset,
  };
  const updated: BotSlotConfig = { ...tuned, lastVisionCheck: keepVisionCheck(tuned) };
  const bots = state.settings.bots.map((b, i) => (i === idx ? updated : b));
  const settings: SettingsFile = { ...state.settings, bots };
  return {
    state: { ...state, settings },
    effects: [{ type: 'save_settings', settings }],
    ack: 'ok',
  };
}

function reclaimExistingPlayer(
  state: RoomState,
  opts: {
    playerId: string;
    oldPlayerId: string;
    newSecret: string;
    isHost?: boolean;
    profileId?: string;
  },
): ReduceOutput {
  const old = state.players[opts.oldPlayerId];
  if (!old) return { state, effects: [] };
  if (old.isHost && opts.isHost === false) return { state, effects: [] };
  const restPlayers = Object.fromEntries(
    Object.entries(state.players).filter(([id]) => id !== opts.oldPlayerId),
  );
  const migrated: PlayerState = {
    ...old,
    profileId: opts.profileId ?? old.profileId,
    id: opts.playerId,
    secret: opts.newSecret,
    connected: true,
    disconnectedAt: undefined,
    isHost: old.isHost || Boolean(opts.isHost),
  };
  const nextOrder = state.playerOrder.map((id) => (id === opts.oldPlayerId ? opts.playerId : id));
  let nextActive = state.loadingOrActive;
  const oldGuess = nextActive?.humanGuesses[opts.oldPlayerId];
  if (nextActive && oldGuess && opts.oldPlayerId !== opts.playerId) {
    const restGuesses = Object.fromEntries(
      Object.entries(nextActive.humanGuesses).filter(([id]) => id !== opts.oldPlayerId),
    );
    nextActive = { ...nextActive, humanGuesses: { ...restGuesses, [opts.playerId]: oldGuess } };
  }
  return {
    state: {
      ...state,
      players: { ...restPlayers, [opts.playerId]: migrated },
      playerOrder: nextOrder,
      loadingOrActive: nextActive,
    },
    effects: [],
  };
}

export function handlePlayerJoinOrReclaim(
  state: RoomState,
  opts:
    | {
        kind: 'join';
        profileId?: string;
        playerId: string;
        avatar?: AvatarAppearance;
        secret: string;
        name: string;
        color: BotSlotConfig['color'];
        isHost: boolean;
      }
    | {
        kind: 'reconnect';
        playerId: string;
        isHost: boolean;
        profileId?: string;
        avatar?: AvatarAppearance;
      }
    | {
        kind: 'reclaim';
        profileId?: string;
        playerId: string;
        oldPlayerId: string;
        newSecret: string;
        isHost?: boolean;
      },
): ReduceOutput {
  if (opts.kind === 'reconnect') {
    const existing = state.players[opts.playerId];
    if (!existing) return { state, effects: [] };
    const updated: PlayerState = {
      ...existing,
      profileId: existing.profileId ?? opts.profileId,
      avatar: opts.avatar ?? existing.avatar,
      connected: true,
      disconnectedAt: undefined,
      isHost: existing.isHost || opts.isHost,
    };
    return {
      state: { ...state, players: { ...state.players, [opts.playerId]: updated } },
      effects: [{ type: 'cancel_guest_seat_expiry', playerId: opts.playerId }],
    };
  }
  if (opts.kind === 'reclaim') {
    return reclaimExistingPlayer(state, opts);
  }

  const isSpectator = state.phase !== 'LOBBY' && state.phase !== 'FINAL';
  const joined: PlayerState = {
    id: opts.playerId,
    profileId: opts.profileId,
    secret: opts.secret,
    name: opts.name,
    color: opts.color,
    avatar: opts.avatar,
    isHost: opts.isHost,
    connected: true,
    isSpectator,
    panoLoaded: false,
    totalScore: 0,
    answeredRounds: 0,
    totalDistanceKm: 0,
  };
  return {
    state: {
      ...state,
      players: { ...state.players, [opts.playerId]: joined },
      playerOrder: [...state.playerOrder, opts.playerId],
    },
    effects: [],
  };
}
