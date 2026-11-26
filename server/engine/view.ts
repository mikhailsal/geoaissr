import { emptyMapRegionReason } from '../../shared/map-availability.ts';
import { roundHarnessProblem } from '../../shared/play-style.ts';
import { COUNTDOWN_MS, type ClientViewState, type PlayerView } from '../../shared/protocol.ts';
import { getRegionLabelRu } from '../../shared/regions.ts';
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

  // The same check as the round start: a Detective needs the harness of its eyes as well.
  const duration = state.settings.roundDurationSec;
  const unavailableBot = state.settings.bots.find(
    (b) => b.enabled && roundHarnessProblem(b, duration, state.availableHarnesses) !== undefined,
  );
  if (unavailableBot) {
    reasons.push(`ИИ-бот «${unavailableBot.name}» недоступен в текущей среде`);
  }
  const { map, region } = state.settings;
  const emptyReason = emptyMapRegionReason(map, region, getRegionLabelRu(region));
  if (emptyReason) reasons.push(emptyReason);
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
      wins6h: p.profileId ? (state.wins6h.byProfileId[p.profileId] ?? 0) : 0,
      id: p.id,
      name: p.name,
      color: p.color,
      avatar: p.avatar,
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
    startedLoadingAt: active.startedLoadingAt,
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
      wins6h: state.wins6h.byBotId[b.slotId] ?? 0,
      id: b.slotId,
      name: b.name,
      color: b.color,
      turnsUsed: b.turnsUsed,
      moveLimit: b.moveLimit,
      status: b.status,
      ...(b.status === 'thinking' && b.guessFinalized === true ? { answered: true as const } : {}),
      abortReason: b.abortReason,
      ...(b.playStyle ? { playStyle: b.playStyle } : {}),
    })),
  };
}

/**
 * Raw CLI output (paths, tool errors, anything the masking missed) is for the host who runs the
 * bots. Other viewers still get the abort reason, just not the dump.
 */
function forViewer<T extends { diagnosticsTail?: string }>(entry: T, viewerIsHost: boolean): T {
  if (viewerIsHost || entry.diagnosticsTail === undefined) return entry;
  return { ...entry, diagnosticsTail: undefined };
}

function projectResults(state: RoomState, viewerIsHost: boolean): ClientViewState['results'] {
  const res = state.results;
  if (state.phase !== 'ROUND_RESULTS' || !res) return undefined;
  const matchStandings = state.settings.showMatchStandings
    ? computeFinalRankings(state).map(({ rank, item }) => ({
        id: item.id,
        name: item.name,
        rank,
        totalScore: item.totalScore,
      }))
    : undefined;
  return {
    completion: res.completion,
    readyIds: res.readyIds ?? [],
    targetLat: res.target.lat,
    targetLng: res.target.lng,
    countryNameRu: res.target.countryNameRu,
    entries: res.entries.map((entry) => ({
      ...forViewer(entry, viewerIsHost),
      wins6h: entry.isAi
        ? (state.wins6h.byBotId[entry.id] ?? 0)
        : (state.wins6h.byProfileId[state.players[entry.id]?.profileId ?? ''] ?? 0),
    })),
    ...(matchStandings ? { matchStandings } : {}),
    humanVsAi: res.humanVsAi,
  };
}

function projectFinal(state: RoomState, viewerIsHost: boolean): ClientViewState['final'] {
  if (state.phase !== 'FINAL') return undefined;
  const ranked = computeFinalRankings(state);
  const standings = ranked.map(({ rank, item }) => ({
    wins6h: item.isAi
      ? (state.wins6h.byBotId[item.id] ?? 0)
      : (state.wins6h.byProfileId[state.players[item.id]?.profileId ?? ''] ?? 0),
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
        botCard:
          item.isAi && entry
            ? { ...forViewer(entry, viewerIsHost), wins6h: state.wins6h.byBotId[item.id] ?? 0 }
            : undefined,
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

export function projectView(state: RoomState, viewerId: string): ClientViewState {
  const viewer = state.players[viewerId];
  const viewerIsHost = Boolean(viewer?.isHost);
  const hostConnected = state.playerOrder.some((id) => {
    const p = state.players[id];
    return Boolean(p?.isHost && p.connected);
  });

  return {
    matchId: state.matchId,
    gen: state.gen,
    phase: state.phase,
    viewerId,
    viewerIsHost,
    viewerIsSpectator: Boolean(viewer?.isSpectator),
    hostConnected,
    fakeMode: state.fakeMode,
    roundNumber: state.roundNumber,
    totalRounds: state.settings.rounds,
    roundDurationSec: state.settings.roundDurationSec,
    moveEnabled: state.settings.moveEnabled,
    map: state.settings.map,
    region: state.settings.region,
    aiWaitWindowSec: state.settings.aiWaitWindowSec,
    showMatchStandings: state.settings.showMatchStandings,
    pushEnabled: state.settings.pushEnabled,
    pushSeconds: state.settings.pushSeconds,
    allowBotPush: state.settings.allowBotPush,
    startBlockedReasons: computeStartBlockedReasons(state),
    settingsNotice: state.settingsNotice,
    quotaWarning: state.quotaWarning,
    matchWriteError: state.matchWriteError,
    winsWarning: state.winsWarning,
    tunnel: state.tunnel,
    quota: state.quotaSummary,
    players: projectPlayers(state),
    bots: state.settings.bots.map((b) => ({ ...b, wins6h: state.wins6h.byBotId[b.id] ?? 0 })),
    availableHarnesses: state.availableHarnesses,
    loading: projectLoading(state),
    active: projectActive(state, viewerId),
    results: projectResults(state, viewerIsHost),
    final: projectFinal(state, viewerIsHost),
  };
}
