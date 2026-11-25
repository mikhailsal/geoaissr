import { PARTICIPANT_COLOR_IDS } from '../../shared/colors.ts';
import type { EngineEvent, ReduceOutput, RoomState } from './types.ts';

export function handleProfileAction(
  state: RoomState,
  event: Extract<EngineEvent, { type: 'update_profile' | 'reset_bot_wins' }>,
  now: number,
): ReduceOutput {
  const player = state.players[event.playerId];
  if (!player || (event.type === 'reset_bot_wins' && !player.isHost))
    return { state, effects: [], ack: 'forbidden' };
  if (
    state.phase !== 'LOBBY' &&
    state.phase !== 'FINAL' &&
    !(event.type === 'update_profile' && event.persisted)
  )
    return { state, effects: [], ack: 'invalid' };
  if (event.type === 'update_profile') {
    if (event.profileId && player.profileId !== event.profileId)
      return { state, effects: [], ack: 'forbidden' };
    const name = event.nick.trim();
    if (!name || name.length > 20 || !PARTICIPANT_COLOR_IDS.includes(event.color)) {
      return { state, effects: [], ack: 'invalid' };
    }
    return {
      state: {
        ...state,
        players: {
          ...state.players,
          [player.id]: {
            ...player,
            name,
            color: event.color,
            avatar: event.avatar ?? player.avatar,
          },
        },
      },
      effects: [],
      ack: 'ok',
    };
  }
  if (!state.settings.bots.some((b) => b.id === event.botId))
    return { state, effects: [], ack: 'invalid' };
  return {
    state,
    effects: [
      { type: 'persist_bot_wins_reset', botId: event.botId, at: new Date(now).toISOString() },
    ],
    ack: 'ok',
  };
}
