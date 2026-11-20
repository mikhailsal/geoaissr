import { normalizeLongitude } from '../../shared/bot-tools.ts';
import { COUNTDOWN_MS, PANO_LOAD_TIMEOUT_MS, ROUND_INTRO_MS } from '../../shared/protocol.ts';
import { finishActiveRoundToResults } from './results.ts';
import type {
  ActiveRoundState,
  BotRoundState,
  EngineEffect,
  EngineEvent,
  ReduceOutput,
  RoomState,
} from './types.ts';

export { COUNTDOWN_MS };

function buildInitialBotsForRound(state: RoomState): {
  bots: Record<string, BotRoundState>;
  enabledCount: number;
} {
  const enabledBots = state.settings.bots.filter((b) => {
    if (!b.enabled) return false;
    const h = state.availableHarnesses.find((x) => x.id === b.harness);
    return Boolean(h?.available);
  });

  const bots: Record<string, BotRoundState> = {};
  for (const bot of enabledBots) {
    bots[bot.id] = {
      slotId: bot.id,
      name: bot.name,
      color: bot.color,
      harness: bot.harness,
      model: bot.model,
      moveLimit: bot.moveLimit,
      turnsUsed: 0,
      status: 'thinking',
      terminationReason: 'в процессе',
      firstGuessAt: null,
      lastGuessAt: null,
      guess: null,
      thumbs: [],
      journal: [],
      startedAt: null,
      finishedAt: null,
    };
  }
  return { bots, enabledCount: enabledBots.length };
}

export function createLoadingStateForRound(
  state: RoomState,
  roundNumber: number,
  now: number,
): {
  nextState: RoomState;
  effects: EngineEffect[];
} {
  const humanGuesses: ActiveRoundState['humanGuesses'] = {};
  const nextPlayers: RoomState['players'] = {};
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (!p) continue;
    nextPlayers[id] = { ...p, isSpectator: false, panoLoaded: false };
    humanGuesses[id] = { pin: null, confirmed: false, confirmedAt: null };
  }

  const { bots, enabledCount } = buildInitialBotsForRound(state);

  const nextGen = state.gen + 1;
  const active: ActiveRoundState = {
    roundNumber,
    startedLoadingAt: now,
    startImagesReady: false,
    startImagesReadyAt: null,
    countdownStartsAt: null,
    target: null,
    roundStartedAt: null,
    roundDeadlineAt: null,
    endsAt: null,
    allHumansConfirmedAt: null,
    humanGuesses,
    bots,
  };

  const nextState: RoomState = {
    ...state,
    gen: nextGen,
    phase: 'ROUND_LOADING',
    roundNumber,
    players: nextPlayers,
    loadingOrActive: active,
    results: null,
  };

  return {
    nextState,
    effects: [
      {
        type: 'prepare_round',
        matchId: nextState.matchId,
        gen: nextGen,
        roundNumber,
        region: nextState.settings.region,
        excludeCountryIds: [...nextState.usedCountryIds],
        withBots: enabledCount > 0,
      },
      {
        type: 'schedule_pano_timeout',
        matchId: nextState.matchId,
        gen: nextGen,
        atMs: now + PANO_LOAD_TIMEOUT_MS,
      },
    ],
  };
}

function getPlayingConnected(state: RoomState): Array<RoomState['players'][string]> {
  return state.playerOrder
    .map((id) => state.players[id])
    .filter((p): p is RoomState['players'][string] => Boolean(p && p.connected && !p.isSpectator));
}

function areAllPlayingHumansPanoReady(state: RoomState): boolean {
  const playingConnected = getPlayingConnected(state);
  return playingConnected.length > 0 && playingConnected.every((p) => p.panoLoaded);
}

function maybeStartCountdown(state: RoomState, now: number, forceTimeout: boolean): ReduceOutput {
  const active = state.loadingOrActive;
  if (state.phase !== 'ROUND_LOADING' || !active || !active.target || active.prepError) {
    return { state, effects: [] };
  }
  if (active.countdownStartsAt !== null) {
    return { state, effects: [] };
  }
  if (getPlayingConnected(state).length === 0) {
    return { state, effects: [] };
  }
  const timedOut = forceTimeout || now - (active.startImagesReadyAt ?? now) >= PANO_LOAD_TIMEOUT_MS;
  if (!areAllPlayingHumansPanoReady(state) && !timedOut) {
    return { state, effects: [] };
  }
  const countdownStartsAt = Math.max(now, active.startedLoadingAt + ROUND_INTRO_MS);
  const nextActive: ActiveRoundState = {
    ...active,
    countdownStartsAt,
  };
  return {
    state: { ...state, loadingOrActive: nextActive },
    effects: [
      {
        type: 'schedule_countdown',
        matchId: state.matchId,
        gen: state.gen,
        atMs: countdownStartsAt + COUNTDOWN_MS,
      },
    ],
  };
}

export function handleRoundPrepared(
  state: RoomState,
  event: Extract<EngineEvent, { type: 'round_prepared' }>,
  now: number,
): ReduceOutput {
  if (
    event.matchId !== state.matchId ||
    event.gen !== state.gen ||
    state.phase !== 'ROUND_LOADING' ||
    !state.loadingOrActive ||
    event.roundNumber !== state.roundNumber
  ) {
    return { state, effects: [] };
  }

  const nextUsed = state.usedCountryIds.includes(event.target.countryId)
    ? state.usedCountryIds
    : [...state.usedCountryIds, event.target.countryId];
  const nextActive: ActiveRoundState = {
    ...state.loadingOrActive,
    target: event.target,
    startImagesReady: true,
    startImagesReadyAt: now,
    prepError: undefined,
  };

  const activeBotIds = Object.keys(nextActive.bots);
  const enabledSlots = state.settings.bots.filter((b) => activeBotIds.includes(b.id));
  const botStartEffect: EngineEffect[] =
    enabledSlots.length > 0
      ? [
          {
            type: 'start_bot_processes',
            matchId: state.matchId,
            gen: state.gen,
            roundNumber: state.roundNumber,
            bots: enabledSlots,
            moveEnabled: state.settings.moveEnabled,
          },
        ]
      : [];

  const updatedState: RoomState = {
    ...state,
    usedCountryIds: nextUsed,
    loadingOrActive: nextActive,
  };
  const countdownOut = maybeStartCountdown(updatedState, now, false);
  return {
    state: countdownOut.state,
    effects: [
      ...botStartEffect,
      {
        type: 'schedule_pano_timeout',
        matchId: state.matchId,
        gen: state.gen,
        atMs: now + PANO_LOAD_TIMEOUT_MS,
      },
      ...countdownOut.effects,
    ],
  };
}

export function handlePanoLoadedInRound(
  state: RoomState,
  playerId: string,
  roundNumber: number,
  now: number,
): ReduceOutput {
  const player = state.players[playerId];
  if (!player) return { state, effects: [], ack: 'forbidden' };
  const clearedPlayer = player.mapsError ? { ...player, mapsError: undefined } : player;
  if (state.phase === 'ROUND_LOADING' && state.roundNumber === roundNumber) {
    const nextPlayers = {
      ...state.players,
      [playerId]: { ...clearedPlayer, panoLoaded: true },
    };
    return maybeStartCountdown({ ...state, players: nextPlayers }, now, false);
  }
  if (clearedPlayer !== player) {
    return {
      state: { ...state, players: { ...state.players, [playerId]: clearedPlayer } },
      effects: [],
      ack: 'ok',
    };
  }
  return { state, effects: [], ack: 'ok' };
}

export function handleCountdownDone(
  state: RoomState,
  event: Extract<EngineEvent, { type: 'countdown_done' }>,
  now: number,
): ReduceOutput {
  if (
    event.matchId !== state.matchId ||
    event.gen !== state.gen ||
    state.phase !== 'ROUND_LOADING' ||
    !state.loadingOrActive
  ) {
    return { state, effects: [] };
  }
  const active = state.loadingOrActive;
  const roundDeadlineAt = now + state.settings.roundDurationSec * 1000;

  const updatedBots: Record<string, BotRoundState> = {};
  const effects: EngineEffect[] = [
    {
      type: 'release_bot_observe',
      matchId: state.matchId,
      gen: state.gen,
      roundNumber: state.roundNumber,
    },
    {
      type: 'schedule_deadline',
      matchId: state.matchId,
      gen: state.gen,
      kind: 'round',
      atMs: roundDeadlineAt,
    },
  ];

  for (const [botId, botState] of Object.entries(active.bots)) {
    const slot = state.settings.bots.find((b) => b.id === botId);
    const budgetSec = Math.min(
      state.settings.roundDurationSec,
      slot?.budgetSec ?? state.settings.roundDurationSec,
    );
    const botDeadline = now + budgetSec * 1000;
    updatedBots[botId] = { ...botState, startedAt: botState.startedAt ?? now };
    if (botDeadline < roundDeadlineAt && botState.status === 'thinking') {
      effects.push({
        type: 'schedule_deadline',
        matchId: state.matchId,
        gen: state.gen,
        kind: 'bot_budget',
        botId,
        atMs: botDeadline,
      });
    }
  }

  return {
    state: {
      ...state,
      phase: 'ROUND_ACTIVE',
      loadingOrActive: {
        ...active,
        roundStartedAt: now,
        roundDeadlineAt,
        endsAt: roundDeadlineAt,
        bots: updatedBots,
      },
    },
    effects,
  };
}

export function checkAllHumansConfirmedAndBotsState(state: RoomState, now: number): ReduceOutput {
  const active = state.loadingOrActive;
  if (
    state.phase !== 'ROUND_ACTIVE' ||
    !active ||
    active.roundStartedAt === null ||
    active.roundDeadlineAt === null
  ) {
    return { state, effects: [] };
  }

  const playingHumans = state.playerOrder
    .map((id) => state.players[id])
    .filter((p): p is RoomState['players'][string] =>
      Boolean(p && !p.isSpectator && active.humanGuesses[p.id] !== undefined),
    );
  const allConfirmed =
    playingHumans.length > 0 &&
    playingHumans.every((p) => active.humanGuesses[p.id]?.confirmed === true);

  if (!allConfirmed) {
    return { state, effects: [] };
  }

  const anyBotThinking = Object.values(active.bots).some((b) => b.status === 'thinking');
  if (!anyBotThinking) {
    return finishActiveRoundToResults(state, now, 'все завершили');
  }

  if (active.allHumansConfirmedAt !== null) {
    return { state, effects: [] };
  }

  const waitEnd = Math.min(
    active.roundDeadlineAt,
    Math.max(now + state.settings.aiWaitWindowSec * 1000, active.roundStartedAt + 60_000),
  );
  if (waitEnd <= now) {
    return finishActiveRoundToResults(state, now, 'истекло окно ожидания ИИ');
  }

  return {
    state: {
      ...state,
      loadingOrActive: {
        ...active,
        allHumansConfirmedAt: now,
        endsAt: waitEnd,
      },
    },
    effects: [
      {
        type: 'schedule_deadline',
        matchId: state.matchId,
        gen: state.gen,
        kind: 'wait',
        atMs: waitEnd,
      },
    ],
  };
}

export function handleActivePinOrGuess(
  state: RoomState,
  event: Extract<EngineEvent, { type: 'set_pin' | 'submit_guess' }>,
  now: number,
): ReduceOutput {
  const active = state.loadingOrActive;
  if (state.phase !== 'ROUND_ACTIVE' || !active || event.roundNumber !== state.roundNumber) {
    return { state, effects: [], ack: 'round_over' };
  }
  const player = state.players[event.playerId];
  const guess = active.humanGuesses[event.playerId];
  if (!player || player.isSpectator || !guess) {
    return { state, effects: [], ack: 'forbidden' };
  }
  if (guess.confirmed) {
    return { state, effects: [], ack: 'already_confirmed' };
  }
  if (
    !Number.isFinite(event.lat) ||
    event.lat < -90 ||
    event.lat > 90 ||
    !Number.isFinite(event.lng)
  ) {
    return { state, effects: [], ack: 'invalid' };
  }
  const cleanCoords = { lat: event.lat, lng: normalizeLongitude(event.lng) };
  const nextGuess =
    event.type === 'set_pin'
      ? { ...guess, pin: cleanCoords }
      : { pin: cleanCoords, confirmed: true, confirmedAt: now };

  const updatedState: RoomState = {
    ...state,
    loadingOrActive: {
      ...active,
      humanGuesses: { ...active.humanGuesses, [event.playerId]: nextGuess },
    },
  };
  if (event.type === 'set_pin') {
    return { state: updatedState, effects: [], ack: 'ok' };
  }
  const res = checkAllHumansConfirmedAndBotsState(updatedState, now);
  return { ...res, ack: 'ok' };
}

export { maybeStartCountdown };
