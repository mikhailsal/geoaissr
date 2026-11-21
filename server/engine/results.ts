import type { RoundResultEntryView } from '../../shared/protocol.ts';
import { accountingFields } from './bot-accounting.ts';
import { finalizeJournal } from './journal.ts';
import {
  calculateRoundScore,
  computeHumanVsAiRound,
  haversineDistanceKm,
  rankStandings,
} from '../../shared/score.ts';
import { getRegionDiagonalKm } from '../../shared/regions.ts';
import type { BotRoundTelemetry, MatchRecord } from '../../shared/storage-schemas.ts';
import { createLoadingStateForRound } from './round.ts';
import type {
  ActiveRoundState,
  BotRoundState,
  EngineEffect,
  ReduceOutput,
  RoomState,
  RoundArchiveRecord,
  RoundResultsState,
  RoundTarget,
} from './types.ts';

type UnrankedEntry = Omit<RoundResultEntryView, 'rank'>;

function finalizeRoundBots(
  bots: Record<string, BotRoundState>,
  now: number,
  timeoutReason: string,
): {
  finalizedBots: Record<string, BotRoundState>;
  abortedBots: Array<{ name: string; reason: string }>;
} {
  const finalizedBots: Record<string, BotRoundState> = {};
  const abortedBots: Array<{ name: string; reason: string }> = [];
  for (const [id, bot] of Object.entries(bots)) {
    if (bot.status === 'thinking') {
      finalizedBots[id] = {
        ...bot,
        status: 'aborted',
        abortReason: timeoutReason,
        terminationReason: timeoutReason,
        finishedAt: now,
      };
      abortedBots.push({ name: bot.name, reason: timeoutReason });
    } else {
      finalizedBots[id] = bot;
      if (bot.status === 'aborted') {
        abortedBots.push({ name: bot.name, reason: bot.terminationReason });
      }
    }
  }
  return { finalizedBots, abortedBots };
}

function scoreHumansForRound(
  state: RoomState,
  active: ActiveRoundState,
  target: RoundTarget,
  diagonalKm: number,
): {
  nextPlayers: RoomState['players'];
  rawEntries: UnrankedEntry[];
  answeredNames: string[];
} {
  const nextPlayers = { ...state.players };
  const rawEntries: UnrankedEntry[] = [];
  const answeredNames: string[] = [];

  for (const pid of state.playerOrder) {
    const p = nextPlayers[pid];
    const hg = active.humanGuesses[pid];
    if (!p || p.isSpectator || !hg) continue;
    const coords = hg.pin;
    const dist = coords ? haversineDistanceKm(coords, target) : null;
    const roundScore = dist !== null ? calculateRoundScore(dist, diagonalKm) : 0;
    const totalScore = p.totalScore + roundScore;
    nextPlayers[pid] = {
      ...p,
      totalScore,
      answeredRounds: p.answeredRounds + (dist !== null ? 1 : 0),
      totalDistanceKm: p.totalDistanceKm + (dist ?? 0),
    };
    if (dist !== null) answeredNames.push(p.name);
    rawEntries.push({
      wins6h: p.profileId ? (state.wins6h.byProfileId[p.profileId] ?? 0) : 0,
      id: p.id,
      name: p.name,
      color: p.color,
      isAi: false,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      distanceKm: dist,
      roundScore,
      totalScore,
      thumbs: [],
    });
  }
  return { nextPlayers, rawEntries, answeredNames };
}

function scoreBotsForRound(
  state: RoomState,
  active: ActiveRoundState,
  finalizedBots: Record<string, BotRoundState>,
  target: RoundTarget,
  diagonalKm: number,
  now: number,
): {
  rawEntries: UnrankedEntry[];
  botTelemetry: BotRoundTelemetry[];
  answeredNames: string[];
} {
  const rawEntries: UnrankedEntry[] = [];
  const botTelemetry: BotRoundTelemetry[] = [];
  const answeredNames: string[] = [];
  const startedAt = active.roundStartedAt ?? now;

  for (const bot of Object.values(finalizedBots)) {
    const guess = bot.guess;
    const dist = guess ? haversineDistanceKm(guess, target) : null;
    const roundScore = dist !== null ? calculateRoundScore(dist, diagonalKm) : 0;
    const priorTotal = state.playedRounds.reduce(
      (sum, r) => sum + (r.entriesByParticipant[bot.slotId]?.roundScore ?? 0),
      0,
    );
    const totalScore = priorTotal + roundScore;
    if (dist !== null) answeredNames.push(bot.name);
    const elapsedMs = Math.max(0, (bot.finishedAt ?? now) - startedAt);

    rawEntries.push({
      wins6h: state.wins6h.byBotId[bot.slotId] ?? 0,
      id: bot.slotId,
      name: bot.name,
      color: bot.color,
      isAi: true,
      lat: guess?.lat ?? null,
      lng: guess?.lng ?? null,
      distanceKm: dist,
      roundScore,
      totalScore,
      explanation: guess?.explanation,
      journal: finalizeJournal(bot),
      usedDraft: guess !== null && bot.guessFinalized === false,
      ...accountingFields(bot),
      quip: guess?.quip,
      turnsUsed: bot.turnsUsed,
      elapsedMs,
      terminationReason: bot.terminationReason,
      diagnosticsTail: guess ? undefined : bot.diagnosticsTail,
      thumbs: bot.thumbs,
    });
    botTelemetry.push({
      botId: bot.slotId,
      name: bot.name,
      harness: bot.harness,
      model: bot.model,
      hadGuessBeforeStop: guess !== null,
      timeToFirstGuessMs:
        bot.firstGuessAt !== null ? Math.max(0, bot.firstGuessAt - startedAt) : null,
      timeToLastGuessMs: bot.lastGuessAt !== null ? Math.max(0, bot.lastGuessAt - startedAt) : null,
      turnsUsed: bot.turnsUsed,
      score: roundScore,
      distanceKm: dist,
      terminationReason: bot.terminationReason,
    });
  }
  return { rawEntries, botTelemetry, answeredNames };
}

function rankRoundEntries(rawEntries: UnrankedEntry[]): RoundResultEntryView[] {
  const sorted = [...rawEntries].sort((a, b) => {
    if (b.roundScore !== a.roundScore) return b.roundScore - a.roundScore;
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    if (a.distanceKm !== null) return -1;
    if (b.distanceKm !== null) return 1;
    return a.name.localeCompare(b.name, 'ru');
  });
  return sorted.map((item, idx) => ({ ...item, rank: idx + 1 }));
}

function buildResultsState(
  state: RoomState,
  active: ActiveRoundState,
  entries: RoundResultEntryView[],
  now: number,
): {
  results: RoundResultsState;
  humansMean: number;
  aiMean: number;
  humansTotal: number;
  aiTotal: number;
} {
  const hasHuman = entries.some((e) => !e.isAi);
  const hasAi = entries.some((e) => e.isAi);
  const hvAiRound = computeHumanVsAiRound(
    entries.map((e) => ({ isAi: e.isAi, playedRound: e.distanceKm !== null, score: e.roundScore })),
  );
  const humansMean = hvAiRound.humansMean ?? 0;
  const aiMean = hvAiRound.aiMean ?? 0;
  const humansTotal = state.humanVsAiTotal.humans + humansMean;
  const aiTotal = state.humanVsAiTotal.ai + aiMean;

  const results: RoundResultsState = {
    completion: {
      finishedAt: now,
      confirmedIds: [
        ...Object.entries(active.humanGuesses)
          .filter(([, guess]) => guess.confirmed)
          .map(([id]) => id),
        ...Object.values(active.bots)
          .filter((bot) => bot.status === 'done')
          .map((bot) => bot.slotId),
      ],
    },
    roundNumber: active.roundNumber,
    target: active.target as RoundTarget,
    entries,
    humanVsAi: {
      visible: hasHuman && hasAi,
      humansRound: humansMean,
      aiRound: aiMean,
      humansTotal,
      aiTotal,
    },
  };
  return { results, humansMean, aiMean, humansTotal, aiTotal };
}

export function finishActiveRoundToResults(
  state: RoomState,
  now: number,
  timeoutReason: string,
): ReduceOutput {
  const active: ActiveRoundState | null = state.loadingOrActive;
  if (!active || !active.target) return { state, effects: [] };
  const target = active.target;
  const diagonalKm = getRegionDiagonalKm(state.settings.region);

  const { finalizedBots, abortedBots } = finalizeRoundBots(active.bots, now, timeoutReason);
  const humanRes = scoreHumansForRound(state, active, target, diagonalKm);
  const botRes = scoreBotsForRound(state, active, finalizedBots, target, diagonalKm, now);

  const entries = rankRoundEntries([...humanRes.rawEntries, ...botRes.rawEntries]);
  const built = buildResultsState(state, active, entries, now);
  const humanWaitMs =
    active.allHumansConfirmedAt !== null && Object.keys(finalizedBots).length > 0
      ? Math.max(0, now - active.allHumansConfirmedAt)
      : null;

  const archive: RoundArchiveRecord = {
    gen: state.gen,
    roundNumber: active.roundNumber,
    target,
    humanWaitMs,
    entriesByParticipant: Object.fromEntries(entries.map((e) => [e.id, e])),
    botTelemetry: botRes.botTelemetry,
    humansMeanScore: built.humansMean,
    aiMeanScore: built.aiMean,
  };

  const nextGen = state.gen + 1;
  return {
    state: {
      ...state,
      gen: nextGen,
      phase: 'ROUND_RESULTS',
      players: humanRes.nextPlayers,
      loadingOrActive: null,
      results: built.results,
      playedRounds: [...state.playedRounds, archive],
      humanVsAiTotal: { humans: built.humansTotal, ai: built.aiTotal },
    },
    effects: [
      { type: 'stop_all_bots', reason: timeoutReason },
      { type: 'clear_round_images' },
      {
        type: 'log_round_end',
        roundNumber: active.roundNumber,
        totalRounds: state.settings.rounds,
        target,
        answeredNames: [...humanRes.answeredNames, ...botRes.answeredNames],
        abortedBots,
      },
    ],
  };
}

interface AggregatedParticipant {
  id: string;
  name: string;
  color: RoomState['players'][string]['color'];
  isAi: boolean;
  totalScore: number;
  answeredRounds: number;
  totalAnsweredDistanceKm: number;
}

export function computeFinalRankings(state: RoomState) {
  const agg = new Map<string, AggregatedParticipant>();
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (!p || p.isSpectator) continue;
    agg.set(p.id, {
      id: p.id,
      name: p.name,
      color: p.color,
      isAi: false,
      totalScore: 0,
      answeredRounds: 0,
      totalAnsweredDistanceKm: 0,
    });
  }
  for (const round of state.playedRounds) {
    for (const [id, entry] of Object.entries(round.entriesByParticipant)) {
      const cur = agg.get(id) ?? {
        id,
        name: entry.name,
        color: entry.color,
        isAi: entry.isAi,
        totalScore: 0,
        answeredRounds: 0,
        totalAnsweredDistanceKm: 0,
      };
      agg.set(id, {
        ...cur,
        totalScore: cur.totalScore + entry.roundScore,
        answeredRounds: cur.answeredRounds + (entry.distanceKm !== null ? 1 : 0),
        totalAnsweredDistanceKm: cur.totalAnsweredDistanceKm + (entry.distanceKm ?? 0),
      });
    }
  }
  return rankStandings([...agg.values()]);
}

export function buildMatchRecord(state: RoomState, now: number): MatchRecord {
  const rankMap = computeFinalRankings(state);
  const participants = rankMap.map((r) => ({
    id: r.item.id,
    profileId: r.item.isAi ? undefined : state.players[r.item.id]?.profileId,
    name: r.item.name,
    isAi: r.item.isAi,
    color: r.item.color,
    totalScore: r.item.totalScore,
    rank: r.rank,
    answeredRounds: r.item.answeredRounds,
    totalDistanceKm: r.item.totalAnsweredDistanceKm,
  }));
  const hasHuman = participants.some((p) => !p.isAi);
  const hasAi = participants.some((p) => p.isAi);

  return {
    version: 1,
    matchId: state.matchId,
    startedAt: state.matchStartedAt ?? new Date(now).toISOString(),
    endedAt: new Date(now).toISOString(),
    region: state.settings.region,
    plannedRounds: state.settings.rounds,
    playedRounds: state.playedRounds.length,
    moveEnabled: state.settings.moveEnabled,
    participants,
    humanVsAi: {
      visible: hasHuman && hasAi && state.playedRounds.length > 0,
      humansTotal: state.humanVsAiTotal.humans,
      aiTotal: state.humanVsAiTotal.ai,
    },
    rounds: state.playedRounds.map((r) => ({
      roundNumber: r.roundNumber,
      targetLat: r.target.lat,
      targetLng: r.target.lng,
      countryNameRu: r.target.countryNameRu,
      humanWaitMs: r.humanWaitMs,
      bots: r.botTelemetry,
    })),
  };
}

export function advanceFromResults(state: RoomState, now: number): ReduceOutput {
  if (state.phase !== 'ROUND_RESULTS' || !state.results) return { state, effects: [] };
  if (state.roundNumber >= state.settings.rounds) {
    const record = buildMatchRecord(state, now);
    const effects: EngineEffect[] = [];
    if (record.playedRounds > 0) {
      effects.push({ type: 'append_match_record', record });
    }
    return {
      state: { ...state, gen: state.gen + 1, phase: 'FINAL', results: null },
      effects,
    };
  }

  const next = createLoadingStateForRound(state, state.roundNumber + 1, now);
  return {
    state: next.nextState,
    effects: next.effects,
  };
}
