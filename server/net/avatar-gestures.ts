import type { ServerWebSocket } from 'bun';
import { GESTURE_INTERVAL_MS } from '../../shared/avatar.ts';
import type { AckResult, ClientMessage, ServerMessage } from '../../shared/protocol.ts';
import { sendJson } from './ws-auth.ts';
import type { CoordCtx, RoomState, WsClientData } from './ws.ts';

/** Gestures are one-shot events. A late join or state refresh must never replay one. */
export function relayAvatarGesture(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  playerId: string,
  msg: Extract<ClientMessage, { type: 'avatar_gesture' | 'avatar_spin' | 'avatar_turn' }>,
): AckResult {
  const state = ctx.shell.getState();
  const player = state.players[playerId];
  if (!player?.connected) return 'forbidden';
  if (state.phase !== 'LOBBY') return 'invalid';
  let participantId = playerId;
  if (msg.type !== 'avatar_gesture') {
    participantId = msg.participantId;
    if (
      !state.playerOrder.includes(participantId) &&
      !state.settings.bots.some((bot) => bot.id === participantId)
    )
      return 'invalid';
  } else if (msg.botId) {
    if (!player.isHost) return 'forbidden';
    if (!state.settings.bots.some((bot) => bot.id === msg.botId)) return 'invalid';
    participantId = msg.botId;
  }
  const now = Date.now();
  let event: ServerMessage;
  if (msg.type === 'avatar_turn') {
    if (!allowBurst(ws.data, 'turnBudgetAt', now, 25)) return 'invalid';
    ctx.avatarTurns.set(participantId, msg.yaw);
    event = { type: 'avatar_turn', serverNow: now, participantId, yaw: msg.yaw };
  } else {
    const gesture = msg.type === 'avatar_spin' ? 'spin' : msg.gesture;
    if (gesture === 'spin') {
      if (!allowBurst(ws.data, 'spinBudgetAt', now, 50)) return 'invalid';
    } else {
      if (now - (ws.data.lastGestureAt ?? 0) < GESTURE_INTERVAL_MS) return 'invalid';
      ws.data.lastGestureAt = now;
    }
    event = { type: 'avatar_gesture', serverNow: now, participantId, gesture };
  }
  for (const peer of ctx.sockets) {
    // Direct manipulation is already visible to the sender.
    if (peer === ws && msg.type !== 'avatar_gesture') continue;
    if (peer.data.authenticated && peer.data.playerId) sendJson(peer, event);
  }
  return 'ok';
}

/** Allow several coalesced pointer events while bounding sustained room broadcasts. */
function allowBurst(
  data: WsClientData,
  key: 'turnBudgetAt' | 'spinBudgetAt',
  now: number,
  interval: number,
) {
  const next = Math.max(data[key] ?? now, now);
  if (next - now >= interval * 6) return false;
  data[key] = next + interval;
  return true;
}

/** A chosen orientation belongs to this lineup, never to a saved player profile. */
export function pruneAvatarTurns(turns: Map<string, number>, state: RoomState): void {
  if (state.phase !== 'LOBBY') {
    turns.clear();
    return;
  }
  for (const id of turns.keys()) {
    if (!state.players[id] && !state.settings.bots.some((bot) => bot.id === id)) turns.delete(id);
  }
}
