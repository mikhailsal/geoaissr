import { buildMatchRecord } from './results.ts';
import type { EngineEffect, ReduceOutput, RoomState } from './types.ts';

export function handleEndMatch(state: RoomState, playerId: string, now: number): ReduceOutput {
  if (!state.players[playerId]?.isHost) return { state, effects: [], ack: 'forbidden' };
  if (state.phase === 'LOBBY' || state.phase === 'FINAL') {
    return { state, effects: [], ack: 'invalid' };
  }

  const effects: EngineEffect[] = [
    { type: 'stop_all_bots', reason: 'партия завершена хостом' },
    { type: 'clear_round_images' },
  ];

  if (state.playedRounds.length > 0) {
    effects.push({ type: 'append_match_record', record: buildMatchRecord(state, now) });
  }

  return {
    state: {
      ...state,
      gen: state.gen + 1,
      phase: 'FINAL',
      loadingOrActive: null,
      results: null,
    },
    effects,
    ack: 'ok',
  };
}

export function handlePlayAgain(state: RoomState, playerId: string): ReduceOutput {
  if (!state.players[playerId]?.isHost) return { state, effects: [], ack: 'forbidden' };
  if (state.phase !== 'FINAL') return { state, effects: [], ack: 'invalid' };

  const resetPlayers: RoomState['players'] = {};
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (!p) continue;
    resetPlayers[id] = {
      ...p,
      isSpectator: false,
      panoLoaded: false,
      mapsError: undefined,
      totalScore: 0,
      answeredRounds: 0,
      totalDistanceKm: 0,
    };
  }

  return {
    state: {
      ...state,
      gen: state.gen + 1,
      matchStartedAt: null,
      phase: 'LOBBY',
      players: resetPlayers,
      usedCountryIds: [],
      roundNumber: 0,
      loadingOrActive: null,
      results: null,
      playedRounds: [],
      humanVsAiTotal: { humans: 0, ai: 0 },
      matchWriteError: undefined,
    },
    effects: [{ type: 'clear_thumbs' }],
    ack: 'ok',
  };
}
