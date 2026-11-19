import type { ServerWebSocket } from 'bun';
import type { AckResult, ClientMessage } from '../../shared/protocol.ts';
import { sendJson } from './ws-auth.ts';
import type { CoordCtx, WsClientData } from './ws.ts';

/** Gestures are one-shot events. A late join or state refresh must never replay one. */
export function relayAvatarGesture(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  playerId: string,
  msg: Extract<ClientMessage, { type: 'avatar_gesture' }>,
): AckResult {
  const state = ctx.shell.getState();
  const player = state.players[playerId];
  if (!player?.connected || (msg.botId && !player.isHost)) return 'forbidden';
  if (state.phase !== 'LOBBY') return 'invalid';
  if (msg.botId && !state.settings.bots.some((bot) => bot.id === msg.botId)) return 'invalid';
  const now = Date.now();
  if (now - (ws.data.lastGestureAt ?? 0) < 250) return 'invalid';
  ws.data.lastGestureAt = now;
  const gesture = {
    type: 'avatar_gesture',
    serverNow: now,
    participantId: msg.botId ?? playerId,
    gesture: msg.gesture,
  } as const;
  for (const peer of ctx.sockets) {
    if (peer.data.authenticated && peer.data.playerId) sendJson(peer, gesture);
  }
  return 'ok';
}
