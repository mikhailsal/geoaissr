import { buildMatchRecord } from './results.ts';
import { DISCONNECTED_GUEST_GRACE_MS } from '../../shared/protocol.ts';
import type { EngineEffect, EngineEvent, ReduceOutput, RoomState } from './types.ts';

type LeaveFinalEvent = Extract<EngineEvent, { type: 'play_again' | 'ready_lobby' }>;

/** A connected guest has not pressed «Готов». The host never marks themselves ready. */
export function someoneNotReady(state: RoomState, readyIds: readonly string[]): boolean {
  return Object.values(state.players).some(
    (p) => !p.isHost && p.connected && !readyIds.includes(p.id),
  );
}

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
      finalReadyIds: [],
    },
    effects,
    ack: 'ok',
  };
}

/** «Готов» on the final screen only tells the host who has finished reading; it never leaves it. */
export function handleReadyLobby(state: RoomState, event: LeaveFinalEvent): ReduceOutput {
  if (state.phase !== 'FINAL') return { state, effects: [], ack: 'invalid' };
  const player = state.players[event.playerId];
  if (!player || player.isHost) return { state, effects: [], ack: 'forbidden' };
  // A click on an earlier final screen that arrives late is dropped.
  if (event.gen !== state.gen) return { state, effects: [], ack: 'invalid' };
  const readyIds = state.finalReadyIds ?? [];
  if (readyIds.includes(player.id)) return { state, effects: [], ack: 'ok' };
  return { state: { ...state, finalReadyIds: [...readyIds, player.id] }, effects: [], ack: 'ok' };
}

export function handlePlayAgain(
  state: RoomState,
  event: LeaveFinalEvent,
  now: number,
): ReduceOutput {
  if (!state.players[event.playerId]?.isHost) return { state, effects: [], ack: 'forbidden' };
  if (state.phase !== 'FINAL') return { state, effects: [], ack: 'invalid' };
  // As on the results screen: without `force` the host's click waits for the guests' «Готов».
  if (!event.force && someoneNotReady(state, state.finalReadyIds ?? [])) {
    return { state, effects: [], ack: 'forbidden' };
  }

  const resetPlayers: RoomState['players'] = {};
  const resetPlayerOrder: string[] = [];
  const seatEffects: EngineEffect[] = [{ type: 'clear_thumbs' }];
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (!p) continue;
    if (!p.isHost && !p.connected && p.disconnectedAt !== undefined) {
      const expiresAt = p.disconnectedAt + DISCONNECTED_GUEST_GRACE_MS;
      if (expiresAt <= now) continue;
      seatEffects.push({ type: 'schedule_guest_seat_expiry', playerId: id, atMs: expiresAt });
    }
    resetPlayerOrder.push(id);
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
      playerOrder: resetPlayerOrder,
      usedCountryIds: [],
      roundNumber: 0,
      loadingOrActive: null,
      results: null,
      finalReadyIds: [],
      playedRounds: [],
      humanVsAiTotal: { humans: 0, ai: 0 },
      matchWriteError: undefined,
    },
    effects: seatEffects,
    ack: 'ok',
  };
}
