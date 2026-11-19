import type { ServerWebSocket } from 'bun';
import { GESTURE_INTERVAL_MS } from '../../shared/avatar.ts';
import type { AckResult, ClientMessage } from '../../shared/protocol.ts';
import { sendJson } from './ws-auth.ts';
import type { CoordCtx, WsClientData } from './ws.ts';

/** Gestures are one-shot events. A late join or state refresh must never replay one. */
export function relayAvatarGesture(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  playerId: string,
  msg: Extract<ClientMessage, { type: 'avatar_gesture' | 'avatar_spin' }>,
): AckResult {
  const state = ctx.shell.getState();
  const player = state.players[playerId];
  if (!player?.connected) return 'forbidden';
  if (state.phase !== 'LOBBY') return 'invalid';
  let participantId = playerId;
  if (msg.type === 'avatar_spin') {
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
  if (now - (ws.data.lastGestureAt ?? 0) < GESTURE_INTERVAL_MS) return 'invalid';
  ws.data.lastGestureAt = now;
  const gesture = {
    type: 'avatar_gesture',
    serverNow: now,
    participantId,
    gesture: msg.type === 'avatar_spin' ? 'spin' : msg.gesture,
  } as const;
  for (const peer of ctx.sockets) {
    if (peer.data.authenticated && peer.data.playerId) sendJson(peer, gesture);
  }
  return 'ok';
}
