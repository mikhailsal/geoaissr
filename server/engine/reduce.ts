import { handleProfileAction } from './profile.ts';
import { handleBotAccounting } from './bot-accounting.ts';
import { handleEndMatch, handlePlayAgain } from './final.ts';
import {
  handleAddBot,
  handleApplyBotPreset,
  handlePlayerJoinOrReclaim,
  handleRemoveBot,
  handleUpdateBot,
  handleUpdateLobby,
} from './lobby.ts';
import { advanceFromResults, finishActiveRoundToResults } from './results.ts';
import {
  checkAllHumansConfirmedAndBotsState,
  createLoadingStateForRound,
  handleActivePinOrGuess,
  handleCountdownDone,
  handlePanoLoadedInRound,
  handleRoundPrepared,
  maybeStartCountdown,
} from './round.ts';
import type { EngineEvent, ReduceOutput, RoomState } from './types.ts';
import { computeStartBlockedReasons } from './view.ts';

function handlePlayerDisconnect(state: RoomState, playerId: string, now: number): ReduceOutput {
  const existing = state.players[playerId];
  if (!existing) return { state, effects: [] };
  const nextState: RoomState = {
    ...state,
    players: { ...state.players, [playerId]: { ...existing, connected: false } },
  };
  if (nextState.phase === 'ROUND_LOADING') {
    return maybeStartCountdown(nextState, now, false);
  }
  return { state: nextState, effects: [] };
}

function handleStartMatch(state: RoomState, playerId: string, now: number): ReduceOutput {
  if (!state.players[playerId]?.isHost) return { state, effects: [], ack: 'forbidden' };
  if (state.phase !== 'LOBBY') return { state, effects: [], ack: 'invalid' };
  if (computeStartBlockedReasons(state).length > 0) {
    return { state, effects: [], ack: 'invalid' };
  }
  const freshState: RoomState = {
    ...state,
    matchStartedAt: new Date(now).toISOString(),
    usedCountryIds: [],
    playedRounds: [],
    humanVsAiTotal: { humans: 0, ai: 0 },
    matchWriteError: undefined,
    tunnel: { ...state.tunnel, changedSinceStart: false },
  };
  const next = createLoadingStateForRound(freshState, 1, now);
  return { state: next.nextState, effects: next.effects, ack: 'ok' };
}

function handleBotEvent(state: RoomState, event: EngineEvent, now: number): ReduceOutput {
  const active = state.loadingOrActive;
  const allowDuringLoading = state.phase === 'ROUND_LOADING';
  if ((state.phase !== 'ROUND_ACTIVE' && !allowDuringLoading) || !active) {
    return { state, effects: [] };
  }
  if (
    event.type !== 'bot_turns_updated' &&
    event.type !== 'bot_thumb_added' &&
    event.type !== 'bot_guess_recorded' &&
    event.type !== 'bot_finished'
  ) {
    return { state, effects: [] };
  }
  if (
    event.matchId !== state.matchId ||
    event.gen !== state.gen ||
    event.roundNumber !== state.roundNumber
  ) {
    return { state, effects: [] };
  }
  const bot = active.bots[event.botId];
  if (!bot || bot.status !== 'thinking') return { state, effects: [] };

  let updatedBot = bot;
  if (event.type === 'bot_turns_updated') {
    updatedBot = { ...bot, turnsUsed: event.turnsUsed };
  } else if (event.type === 'bot_thumb_added') {
    updatedBot = { ...bot, thumbs: [...bot.thumbs, event.thumb] };
  } else if (event.type === 'bot_guess_recorded') {
    if (bot.guessFinalized) return { state, effects: [] };
    updatedBot = {
      ...bot,
      firstGuessAt: bot.firstGuessAt ?? now,
      lastGuessAt: now,
      guess: event.guess,
      guessFinalized: event.finalized ?? true,
    };
  } else {
    updatedBot = {
      ...bot,
      status: event.aborted ? 'aborted' : 'done',
      abortReason: event.aborted ? event.reason : undefined,
      terminationReason: event.reason,
      diagnosticsTail: event.diagnosticsTail,
      finishedAt: now,
    };
  }

  const nextState: RoomState = {
    ...state,
    loadingOrActive: {
      ...active,
      bots: { ...active.bots, [event.botId]: updatedBot },
    },
  };
  if (event.type === 'bot_finished') {
    return checkAllHumansConfirmedAndBotsState(nextState, now);
  }
  return { state: nextState, effects: [] };
}

function handleDeadlineTick(
  state: RoomState,
  event: Extract<EngineEvent, { type: 'deadline_tick' }>,
  now: number,
): ReduceOutput {
  if (
    event.matchId !== state.matchId ||
    event.gen !== state.gen ||
    state.phase !== 'ROUND_ACTIVE' ||
    !state.loadingOrActive
  ) {
    return { state, effects: [] };
  }
  if (event.kind === 'round') {
    return finishActiveRoundToResults(state, now, 'истекло время раунда');
  }
  if (event.kind === 'wait') {
    return finishActiveRoundToResults(state, now, 'истекло окно ожидания ИИ');
  }
  const botId = event.botId;
  const bot = botId ? state.loadingOrActive.bots[botId] : undefined;
  if (!botId || !bot || bot.status !== 'thinking') return { state, effects: [] };
  const nextState: RoomState = {
    ...state,
    loadingOrActive: {
      ...state.loadingOrActive,
      bots: {
        ...state.loadingOrActive.bots,
        [botId]: {
          ...bot,
          status: 'aborted',
          abortReason: 'истек бюджет времени бота',
          terminationReason: 'истек бюджет времени',
          finishedAt: now,
        },
      },
    },
  };
  const checked = checkAllHumansConfirmedAndBotsState(nextState, now);
  return {
    state: checked.state,
    effects: [
      {
        type: 'stop_bot_process',
        matchId: state.matchId,
        gen: state.gen,
        botId,
        reason: 'budget_expired',
      },
      ...checked.effects,
    ],
  };
}

/** Results stay on screen until the host moves on; there is no auto-advance timer. */
function handleNextRound(
  state: RoomState,
  event: Extract<EngineEvent, { type: 'next_round' }>,
  now: number,
): ReduceOutput {
  if (state.phase !== 'ROUND_RESULTS' || !state.results) {
    return { state, effects: [], ack: 'round_over' };
  }
  if (!state.players[event.playerId]?.isHost) return { state, effects: [], ack: 'forbidden' };
  if (event.roundNumber !== state.roundNumber) return { state, effects: [], ack: 'round_over' };
  return { ...advanceFromResults(state, now), ack: 'ok' };
}

function handlePlayerReconnectWithWake(
  state: RoomState,
  event: Extract<EngineEvent, { type: 'player_reconnect' }>,
  now: number,
): ReduceOutput {
  const joined = handlePlayerJoinOrReclaim(state, { kind: 'reconnect', ...event });
  if (joined.state.phase === 'ROUND_LOADING') {
    return maybeStartCountdown(joined.state, now, false);
  }
  return joined;
}

function handleMiscStateEvent(state: RoomState, event: EngineEvent): ReduceOutput | null {
  switch (event.type) {
    case 'update_bot_vision_check': {
      const bots = state.settings.bots.map((b) =>
        b.id === event.botId ? { ...b, lastVisionCheck: event.check } : b,
      );
      const settings = { ...state.settings, bots };
      return { state: { ...state, settings }, effects: [{ type: 'save_settings', settings }] };
    }
    case 'confirm_quota_reset':
      if (!state.players[event.playerId]?.isHost) return { state, effects: [], ack: 'forbidden' };
      return {
        // needsResetConfirm stays set until the reset is persisted and quota_updated arrives.
        state,
        effects: [{ type: 'confirm_quota_reset' }],
        ack: 'ok',
      };
    case 'quota_updated':
      return {
        state: { ...state, quotaSummary: event.quotaSummary, quotaWarning: event.quotaWarning },
        effects: [],
      };
    case 'tunnel_updated':
      return {
        state: {
          ...state,
          tunnel: {
            ...event.tunnel,
            changedSinceStart: state.phase !== 'LOBBY' || state.tunnel.changedSinceStart,
          },
        },
        effects: [],
      };
    case 'bot_wins_reset_result': {
      if (!event.ok)
        return {
          state: { ...state, winsWarning: 'Не удалось сохранить сброс побед ИИ.' },
          effects: [],
        };
      const bots = state.settings.bots.map((b) =>
        b.id === event.botId ? { ...b, winResetAt: event.at } : b,
      );
      return { state: { ...state, settings: { ...state.settings, bots } }, effects: [] };
    }
    case 'match_write_result':
      return {
        state: { ...state, matchWriteError: event.ok ? undefined : event.error },
        effects: [],
      };
    case 'client_error': {
      const p = state.players[event.playerId];
      if (!p) return { state, effects: [] };
      const msg = event.code === 'OK' ? undefined : `${event.code}: ${event.message}`;
      return {
        state: {
          ...state,
          players: { ...state.players, [event.playerId]: { ...p, mapsError: msg } },
        },
        effects: [],
      };
    }
    default:
      return null;
  }
}

function reduceRoundPrepAndTimeout(
  state: RoomState,
  event: EngineEvent,
  now: number,
): ReduceOutput | null {
  switch (event.type) {
    case 'round_prepared':
      return handleRoundPrepared(state, event, now);
    case 'round_prep_failed':
      if (
        event.matchId !== state.matchId ||
        event.gen !== state.gen ||
        state.phase !== 'ROUND_LOADING' ||
        !state.loadingOrActive
      ) {
        return { state, effects: [] };
      }
      return {
        state: { ...state, loadingOrActive: { ...state.loadingOrActive, prepError: event.reason } },
        effects: [],
      };
    case 'retry_round': {
      if (!state.players[event.playerId]?.isHost) return { state, effects: [], ack: 'forbidden' };
      if (
        state.phase !== 'ROUND_LOADING' ||
        event.gen !== state.gen ||
        !state.loadingOrActive?.prepError
      ) {
        return { state, effects: [], ack: 'invalid' };
      }
      const next = createLoadingStateForRound(state, state.roundNumber, now);
      return { state: next.nextState, effects: next.effects, ack: 'ok' };
    }
    case 'pano_loaded':
      return handlePanoLoadedInRound(state, event.playerId, event.roundNumber, now);
    case 'pano_load_timeout':
      if (event.matchId !== state.matchId || event.gen !== state.gen) return { state, effects: [] };
      return maybeStartCountdown(state, now, true);
    case 'countdown_done':
      return handleCountdownDone(state, event, now);
    default:
      return null;
  }
}

export function reduce(state: RoomState, event: EngineEvent, now = Date.now()): ReduceOutput {
  const misc = handleMiscStateEvent(state, event) ?? reduceRoundPrepAndTimeout(state, event, now);
  if (misc) return misc;

  switch (event.type) {
    case 'update_profile':
    case 'reset_bot_wins':
      return handleProfileAction(state, event, now);
    case 'player_join':
      return handlePlayerJoinOrReclaim(state, { kind: 'join', ...event });
    case 'player_reconnect':
      return handlePlayerReconnectWithWake(state, event, now);
    case 'player_reclaim_nick':
      return handlePlayerJoinOrReclaim(state, { kind: 'reclaim', ...event });
    case 'player_disconnect':
      return handlePlayerDisconnect(state, event.playerId, now);
    case 'update_lobby':
      return handleUpdateLobby(state, event.playerId, event.patch);
    case 'add_bot':
      return handleAddBot(state, event.playerId);
    case 'remove_bot':
      return handleRemoveBot(state, event.playerId, event.botId);
    case 'update_bot':
      return handleUpdateBot(state, event.playerId, event.botId, event.patch);
    case 'apply_bot_preset':
      return handleApplyBotPreset(state, event.playerId, event.botId, event.preset);
    case 'start_match':
      return handleStartMatch(state, event.playerId, now);
    case 'set_pin':
    case 'submit_guess':
      return handleActivePinOrGuess(state, event, now);
    case 'bot_turns_updated':
    case 'bot_thumb_added':
    case 'bot_guess_recorded':
    case 'bot_finished':
      return handleBotEvent(state, event, now);
    case 'bot_accounting':
      return handleBotAccounting(state, event);
    case 'deadline_tick':
      return handleDeadlineTick(state, event, now);
    case 'next_round':
      return handleNextRound(state, event, now);
    case 'end_match':
      return handleEndMatch(state, event.playerId, now);
    case 'play_again':
      return handlePlayAgain(state, event.playerId);
    default:
      return { state, effects: [] };
  }
}
