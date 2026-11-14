import {
  COUNTDOWN_MS,
  RESULTS_PAUSE_CAP_MS,
  type ClientViewState,
  type PlayerView,
} from '../../shared/protocol.ts';
import { computeFinalRankings } from './results.ts';
import type { RoomState } from './types.ts';

export function computeStartBlockedReasons(state: RoomState): string[] {
  const reasons: string[] = [];
  if (state.quotaSummary.needsResetConfirm) {
    reasons.push('Подтвердите сброс квот за новый месяц перед стартом');
  } else if (!state.quotaSummary.sufficient) {
    reasons.push(state.quotaSummary.exceedsMessage ?? 'Недостаточно квот Google API на партию');
  }

  const hostPlayer = state.playerOrder.map((id) => state.players[id]).find((p) => p?.isHost);
  if (!state.fakeMode && hostPlayer?.mapsError) {
    reasons.push(`Карта у хоста не загрузилась: ${hostPlayer.mapsError}`);
  }

  const unavailableBot = state.settings.bots.find((b) => {
    if (!b.enabled) return false;
    const h = state.availableHarnesses.find((x) => x.id === b.harness);
    return !h?.available;
  });
  if (unavailableBot) {
    reasons.push(`ИИ-бот «${unavailableBot.name}» недоступен в текущей среде`);
  }
  return reasons;
}

function projectPlayers(state: RoomState): PlayerView[] {
  const active = state.loadingOrActive;
  const players: PlayerView[] = [];
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (!p) continue;
    const hg = active?.humanGuesses[id];
    players.push({
      id: p.id,
      name: p.name,
      color: p.color,
      isHost: p.isHost,
      connected: p.connected,
      isSpectator: p.isSpectator,
      mapsError: p.mapsError,
      panoLoaded: p.panoLoaded,
      hasPin: Boolean(hg?.pin),
      confirmed: Boolean(hg?.confirmed),
      totalScore: p.totalScore,
      answeredRounds: p.answeredRounds,
      totalDistanceKm: p.totalDistanceKm,
    });
  }
  return players;
}

function projectLoading(state: RoomState): ClientViewState['loading'] {
  const active = state.loadingOrActive;
  if (state.phase !== 'ROUND_LOADING' || !active) return undefined;
  const waitingFor = state.playerOrder
    .map((id) => state.players[id])
    .filter((p): p is NonNullable<typeof p> =>
      Boolean(p && p.connected && !p.isSpectator && !p.panoLoaded),
    )
    .map((p) => p.name);
  return {
    waitingFor,
    countdownStartsAt: active.countdownStartsAt,
    countdownSeconds: active.countdownStartsAt !== null ? COUNTDOWN_MS / 1000 : null,
    prepError: active.prepError,
    panoId: active.target?.panoId,
    fakeSceneIndex: active.target?.fakeSceneIndex,
  };
}

function projectActive(state: RoomState, viewerId: string): ClientViewState['active'] {
  const active = state.loadingOrActive;
  if (state.phase !== 'ROUND_ACTIVE' || !active || !active.target) return undefined;
  const myGuess = active.humanGuesses[viewerId];
  const playingHumans = state.playerOrder
    .map((id) => state.players[id])
    .filter((p): p is NonNullable<typeof p> =>
      Boolean(p && !p.isSpectator && active.humanGuesses[p.id] !== undefined),
    );
  const confirmedCount = playingHumans.filter((p) => active.humanGuesses[p.id]?.confirmed).length;

  return {
    panoId: active.target.panoId,
    fakeSceneIndex: active.target.fakeSceneIndex,
    endsAt: active.endsAt ?? active.roundDeadlineAt ?? 0,
    allHumansConfirmed: active.allHumansConfirmedAt !== null,
    myPin: myGuess?.pin ?? null,
    myConfirmed: Boolean(myGuess?.confirmed),
    confirmedCount,
    playingHumanCount: playingHumans.length,
    botProgress: Object.values(active.bots).map((b) => ({
      id: b.slotId,
      name: b.name,
      color: b.color,
      turnsUsed: b.turnsUsed,
      moveLimit: b.moveLimit,
      status: b.status,
      abortReason: b.abortReason,
    })),
  };
}

function projectResults(state: RoomState, now: number): ClientViewState['results'] {
  const res = state.results;
  if (state.phase !== 'ROUND_RESULTS' || !res) return undefined;
  const readerNames = Object.values(res.readers);
  const pausedByReaderName =
    readerNames.length === 0
      ? null
      : readerNames.length === 1
        ? (readerNames[0] ?? null)
        : `${readerNames[0] ?? ''} (+${readerNames.length - 1})`;
  const elapsedSinceResume = Math.max(0, now - res.lastResumeAt);
  const pauseRemainingMs =
    pausedByReaderName !== null
      ? Math.max(0, RESULTS_PAUSE_CAP_MS - res.pauseUsedMs - elapsedSinceResume)
      : Math.max(0, RESULTS_PAUSE_CAP_MS - res.pauseUsedMs);
  const autoNextPaused = pausedByReaderName !== null || res.waitingForHuman;
  const autoNextEndsAt = autoNextPaused
    ? now + res.autoNextBaseRemainingMs
    : res.lastResumeAt + res.autoNextBaseRemainingMs;

  return {
    targetLat: res.target.lat,
    targetLng: res.target.lng,
    countryNameRu: res.target.countryNameRu,
    entries: res.entries,
    humanVsAi: res.humanVsAi,
    autoNextEndsAt,
    autoNextFrozenMs: autoNextPaused ? res.autoNextBaseRemainingMs : null,
    pausedByReaderName,
    pauseRemainingMs,
  };
}

function projectFinal(state: RoomState): ClientViewState['final'] {
  if (state.phase !== 'FINAL') return undefined;
  const ranked = computeFinalRankings(state);
  const standings = ranked.map(({ rank, item }) => ({
    id: item.id,
    name: item.name,
    color: item.color,
    isAi: item.isAi,
    rank,
    totalScore: item.totalScore,
    answeredRounds: item.answeredRounds,
    perRound: state.playedRounds.map((round) => {
      const entry = round.entriesByParticipant[item.id];
      return {
        roundNumber: round.roundNumber,
        played: Boolean(entry && entry.distanceKm !== null),
        score: entry ? entry.roundScore : null,
        distanceKm: entry ? entry.distanceKm : null,
        botCard: item.isAi ? entry : undefined,
      };
    }),
  }));
  const hasHuman = standings.some((s) => !s.isAi);
  const hasAi = standings.some((s) => s.isAi);
  return {
    playedRounds: state.playedRounds.length,
    plannedRounds: state.settings.rounds,
    standings,
    humanVsAi: {
      visible: hasHuman && hasAi && state.playedRounds.length > 0,
      humansTotal: state.humanVsAiTotal.humans,
      aiTotal: state.humanVsAiTotal.ai,
    },
  };
}

export function projectView(state: RoomState, viewerId: string, now = Date.now()): ClientViewState {
  const viewer = state.players[viewerId];
  const hostConnected = state.playerOrder.some((id) => {
    const p = state.players[id];
    return Boolean(p?.isHost && p.connected);
  });

  return {
    matchId: state.matchId,
    gen: state.gen,
    phase: state.phase,
    viewerId,
    viewerIsHost: Boolean(viewer?.isHost),
    viewerIsSpectator: Boolean(viewer?.isSpectator),
    hostConnected,
    fakeMode: state.fakeMode,
    roundNumber: state.roundNumber,
    totalRounds: state.settings.rounds,
    roundDurationSec: state.settings.roundDurationSec,
    moveEnabled: state.settings.moveEnabled,
    region: state.settings.region,
    aiWaitWindowSec: state.settings.aiWaitWindowSec,
    startBlockedReasons: computeStartBlockedReasons(state),
    settingsNotice: state.settingsNotice,
    quotaWarning: state.quotaWarning,
    matchWriteError: state.matchWriteError,
    tunnel: state.tunnel,
    quota: state.quotaSummary,
    players: projectPlayers(state),
    bots: state.settings.bots,
    availableHarnesses: state.availableHarnesses,
    loading: projectLoading(state),
    active: projectActive(state, viewerId),
    results: projectResults(state, now),
    final: projectFinal(state),
  };
}
