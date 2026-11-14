import {
  botNameFromModel,
  PRESET_CONFIGS,
  personalityTextSchema,
  type BotImageSize,
  type DifficultyPreset,
  type EffortLevel,
  type PersonalityPreset,
} from '../../shared/bot-tools.ts';
import { pickFirstFreeColor } from '../../shared/colors.ts';
import { MAX_BOTS, type HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { BotSlotConfig, HarnessId, SettingsFile } from '../../shared/storage-schemas.ts';
import type { PlayerState, ReduceOutput, RoomState } from './types.ts';

/** Default names before bots were named after their model; still treated as untouched. */
const LEGACY_DEFAULT_BOT_NAMES = new Set([
  'ИИ Клод',
  'ИИ Кодекс',
  'ИИ Агент',
  'ИИ 1',
  'ИИ 2',
  'ИИ 3',
]);

/** True while the host has not renamed the bot, so its name may follow the model. */
function hasAutoName(slot: Pick<BotSlotConfig, 'name' | 'model'>): boolean {
  return slot.name === botNameFromModel(slot.model) || LEGACY_DEFAULT_BOT_NAMES.has(slot.name);
}
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
          ? 'haiku'
          : usable.id === 'codex'
            ? 'gpt-6-luna'
            : 'gemini-3.8-flash-low'),
      enabled: true,
    };
  }
  const first = availableHarnesses[0];
  return {
    harness: first?.id ?? 'claude',
    model: first?.models[0] ?? 'haiku',
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
  patch: Partial<
    Pick<SettingsFile, 'rounds' | 'roundDurationSec' | 'moveEnabled' | 'region' | 'aiWaitWindowSec'>
  >,
): ReduceOutput {
  if (state.phase !== 'LOBBY') return { state, effects: [], ack: 'forbidden' };
  const player = state.players[playerId];
  if (!player?.isHost) return { state, effects: [], ack: 'forbidden' };

  const hasEnabledBot = state.settings.bots.some((b) => b.enabled);
  let requestedDuration = patch.roundDurationSec ?? state.settings.roundDurationSec;
  let notice: string | undefined;
  if (hasEnabledBot && requestedDuration < 60) {
    requestedDuration = 60;
    notice = 'Длительность раунда не может быть меньше 60 с при включённых ИИ';
  }

  const nextSettings: SettingsFile = {
    ...state.settings,
    ...patch,
    roundDurationSec: requestedDuration,
  };
  return {
    state: { ...state, settings: nextSettings, settingsNotice: notice },
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

function mergeBotSlotPatch(
  slot: BotSlotConfig,
  patch: Record<string, unknown>,
  availableHarnesses: readonly HarnessCatalogEntry[],
): BotSlotConfig {
  const next: BotSlotConfig = { ...slot };
  // An empty name hands naming back to the model (see the end of this function).
  const nameFollowsModel =
    typeof patch.name === 'string' ? patch.name.trim() === '' : hasAutoName(slot);
  if (typeof patch.name === 'string' && !nameFollowsModel) next.name = patch.name;
  if (typeof patch.color === 'string') next.color = patch.color as BotSlotConfig['color'];
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.harness === 'string') {
    next.harness = patch.harness as HarnessId;
  }
  const activeEntry = availableHarnesses.find((h) => h.id === next.harness);
  if (!activeEntry || !activeEntry.available) {
    next.enabled = false;
    next.disabledReason = activeEntry?.reason ?? `Харнесс ${next.harness} недоступен`;
  } else {
    next.disabledReason = undefined;
    if (typeof patch.harness === 'string') {
      const firstModel = activeEntry.models[0];
      if (
        typeof patch.model !== 'string' &&
        firstModel &&
        !activeEntry.models.includes(next.model)
      ) {
        next.model = firstModel;
      }
    }
  }
  if (typeof patch.model === 'string') next.model = patch.model;
  if (typeof patch.budgetSec === 'number') next.budgetSec = patch.budgetSec;
  if (typeof patch.personalityPreset === 'string') {
    next.personalityPreset = patch.personalityPreset as PersonalityPreset;
  }
  if (typeof patch.personalityText === 'string') {
    const parsed = personalityTextSchema.safeParse(patch.personalityText);
    if (parsed.success) next.personalityText = parsed.data;
  }

  let changedTuning = false;
  if (typeof patch.effort === 'string') {
    next.effort = patch.effort as EffortLevel;
    changedTuning = true;
  }
  if (typeof patch.moveLimit === 'number') {
    next.moveLimit = patch.moveLimit;
    changedTuning = true;
  }
  if (typeof patch.imageSize === 'number') {
    next.imageSize = patch.imageSize as BotImageSize;
    changedTuning = true;
  }
  if (changedTuning) {
    next.difficultyPreset = 'custom';
  }
  if (nameFollowsModel && (next.model !== slot.model || typeof patch.name === 'string')) {
    next.name = botNameFromModel(next.model);
  }
  if (
    next.lastVisionCheck &&
    (next.lastVisionCheck.model !== next.model ||
      next.lastVisionCheck.effort !== next.effort ||
      next.lastVisionCheck.imageSize !== next.imageSize)
  ) {
    next.lastVisionCheck = undefined;
  }
  return next;
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
  const updated = mergeBotSlotPatch(existingBot, patch, state.availableHarnesses);
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
  const updated: BotSlotConfig = {
    ...cur,
    imageSize: cfg.imageSize,
    moveLimit: cfg.moveLimit,
    effort: cfg.effort,
    difficultyPreset: preset,
    lastVisionCheck:
      cur.lastVisionCheck &&
      cur.lastVisionCheck.model === cur.model &&
      cur.lastVisionCheck.effort === cfg.effort &&
      cur.lastVisionCheck.imageSize === cfg.imageSize
        ? cur.lastVisionCheck
        : undefined,
  };
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
  opts: { playerId: string; oldPlayerId: string; newSecret: string; isHost?: boolean },
): ReduceOutput {
  const old = state.players[opts.oldPlayerId];
  if (!old) return { state, effects: [] };
  if (old.isHost && opts.isHost === false) return { state, effects: [] };
  const restPlayers = Object.fromEntries(
    Object.entries(state.players).filter(([id]) => id !== opts.oldPlayerId),
  );
  const migrated: PlayerState = {
    ...old,
    id: opts.playerId,
    secret: opts.newSecret,
    connected: true,
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
  let nextResults = state.results;
  const oldReader = nextResults?.readers[opts.oldPlayerId];
  if (nextResults && oldReader && opts.oldPlayerId !== opts.playerId) {
    const restReaders = Object.fromEntries(
      Object.entries(nextResults.readers).filter(([id]) => id !== opts.oldPlayerId),
    );
    nextResults = { ...nextResults, readers: { ...restReaders, [opts.playerId]: oldReader } };
  }
  return {
    state: {
      ...state,
      players: { ...restPlayers, [opts.playerId]: migrated },
      playerOrder: nextOrder,
      loadingOrActive: nextActive,
      results: nextResults,
    },
    effects: [],
  };
}

export function handlePlayerJoinOrReclaim(
  state: RoomState,
  opts:
    | {
        kind: 'join';
        playerId: string;
        secret: string;
        name: string;
        color: BotSlotConfig['color'];
        isHost: boolean;
      }
    | { kind: 'reconnect'; playerId: string; isHost: boolean }
    | {
        kind: 'reclaim';
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
      connected: true,
      isHost: existing.isHost || opts.isHost,
    };
    return {
      state: { ...state, players: { ...state.players, [opts.playerId]: updated } },
      effects: [],
    };
  }
  if (opts.kind === 'reclaim') {
    return reclaimExistingPlayer(state, opts);
  }

  const isSpectator = state.phase !== 'LOBBY' && state.phase !== 'FINAL';
  const joined: PlayerState = {
    id: opts.playerId,
    secret: opts.secret,
    name: opts.name,
    color: opts.color,
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
