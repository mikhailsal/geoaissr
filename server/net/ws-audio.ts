import type { ServerWebSocket } from 'bun';
import type { AckResult, ClientMessage } from '../../shared/protocol.ts';
import type { CoordCtx, WsClientData } from './ws.ts';
import { sendJson, STORE_UNAVAILABLE } from './ws-auth.ts';

/** Save only the authenticated socket owner's preferences, independently of game phase. */
export async function handleAudioPreferences(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: Extract<ClientMessage, { type: 'update_audio_preferences' }>,
  playerId: string,
): Promise<void> {
  let result: AckResult = 'forbidden';
  let message: string | undefined;
  if (ws.data.profileId) {
    try {
      await ctx.profiles.editAudioPreferences(ws.data.profileId, msg.preferences, true);
      result = 'ok';
    } catch {
      result = 'invalid';
      message = STORE_UNAVAILABLE;
    }
  }
  const previous = ws.data.lastSeqByPlayer.get(playerId);
  if (!previous || msg.seq >= previous.seq)
    ws.data.lastSeqByPlayer.set(playerId, { seq: msg.seq, result, commandType: msg.type });
  sendJson(ws, { type: 'ack', serverNow: Date.now(), seq: msg.seq, result, message });
}
