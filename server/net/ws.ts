import {
  sendJson,
  handleHelloMsg,
  handleJoinMsg,
  handleProfileLogin,
  profileError,
  handleProfileEdit,
} from './ws-auth.ts';
import type { ServerWebSocket } from 'bun';
import { handleAudioPreferences } from './ws-audio.ts';
import {
  MAX_WS_MESSAGE_BYTES,
  clientMessageSchema,
  type AckResult,
  type ClientMessage,
} from '../../shared/protocol.ts';
import type { BotRunner } from '../bots/runner.ts';
import type { RoomShell } from '../engine/shell.ts';
import { type RoomState } from '../engine/types.ts';
import type { ProfileStore } from '../storage/profiles.ts';
import type { QuotaManager } from '../storage/quota.ts';
import type { RateLimiter } from './rate-limit.ts';
import {
  checkUpgradeCapacity,
  dispatchEngineClientMessage,
  handleMapLoadedMsg,
  handlePanoLoadedMsg,
  handleVisionCheckMsg,
  scheduleUnauthClose,
} from './ws-actions.ts';

export interface WsClientData {
  connId: string;
  ip: string;
  authenticated: boolean;
  role: 'host' | 'guest' | null;
  playerId: string | null;
  profileId?: string | null;
  authTimer: ReturnType<typeof setTimeout> | null;
  /** When hello succeeded; used to evict sockets that authenticate but never join. */
  authenticatedAt: number | null;
  lastSeqByPlayer: Map<
    string,
    { seq: number; result: AckResult; commandType?: 'update_audio_preferences' }
  >;
  countedPanoRounds: Set<number>;
}

export interface WsRoomCoordinator {
  canAcceptUpgrade: (ip: string) => { ok: true } | { ok: false; status: number; message: string };
  openSocket: (ws: ServerWebSocket<WsClientData>) => void;
  closeSocket: (ws: ServerWebSocket<WsClientData>) => void;
  handleRawMessage: (ws: ServerWebSocket<WsClientData>, raw: string | Buffer) => void;
  broadcastState: () => void;
  closeAll: () => void;
}

export interface CoordCtx {
  profiles: ProfileStore;
  shell: RoomShell;
  hostToken: string;
  guestToken: string;
  browserMapsKey: string | null;
  fakeMode: boolean;
  quotaManager: QuotaManager;
  botRunner?: BotRunner;
  rateLimiter: RateLimiter;
  sockets: Set<ServerWebSocket<WsClientData>>;
  inflightVisionChecks: Set<string>;
  countedPanoKeys: Set<string>;
  countedMapKindsByConnId: Map<string, Set<string>>;
  countedMapCountsByMatchPlayer: Map<string, number>;
  versionRef: { value: number };
  broadcastState: () => void;
}

/** Keep acknowledgements from delayed work from moving the replay watermark backwards. */
function acknowledgeAction(
  ws: ServerWebSocket<WsClientData>,
  playerId: string,
  seq: number,
  result: AckResult,
): void {
  const previous = ws.data.lastSeqByPlayer.get(playerId);
  if (!previous || seq >= previous.seq) ws.data.lastSeqByPlayer.set(playerId, { seq, result });
  sendJson(ws, { type: 'ack', serverNow: Date.now(), seq, result });
}

function handleAuthenticatedAction(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: ClientMessage,
  playerId: string,
): void {
  if (msg.type === 'ping') {
    sendJson(ws, { type: 'pong', serverNow: Date.now(), clientNow: msg.clientNow });
    return;
  }
  if (msg.type === 'join' || msg.type === 'hello' || msg.type === 'profile_login') return;

  const prev = ws.data.lastSeqByPlayer.get(playerId);
  if (prev && msg.seq <= prev.seq) {
    const sameAudioCommand = msg.seq === prev.seq && prev.commandType === msg.type;
    const result =
      msg.type === 'update_audio_preferences' && !sameAudioCommand ? 'invalid' : prev.result;
    sendJson(ws, { type: 'ack', serverNow: Date.now(), seq: msg.seq, result });
    return;
  }

  if (msg.type === 'check_bot_vision') {
    handleVisionCheckMsg({
      shell: ctx.shell,
      botRunner: ctx.botRunner,
      inflightVisionChecks: ctx.inflightVisionChecks,
      playerId,
      msg,
      sendAck: (result) => {
        acknowledgeAction(ws, playerId, msg.seq, result);
      },
      onVisionResult: (resultMsg) => {
        for (const s of ctx.sockets) {
          if (s.data.authenticated && s.data.role === 'host') sendJson(s, resultMsg);
        }
      },
    });
    return;
  }

  if (msg.type === 'pano_loaded') {
    const res = handlePanoLoadedMsg({
      shell: ctx.shell,
      quotaManager: ctx.quotaManager,
      fakeMode: ctx.fakeMode,
      countedPanoKeys: ctx.countedPanoKeys,
      playerId,
      msg,
    });
    ws.data.lastSeqByPlayer.set(playerId, { seq: msg.seq, result: res });
    sendJson(ws, { type: 'ack', serverNow: Date.now(), seq: msg.seq, result: res });
    return;
  }

  if (msg.type === 'map_loaded') {
    const res = handleMapLoadedMsg({
      shell: ctx.shell,
      quotaManager: ctx.quotaManager,
      fakeMode: ctx.fakeMode,
      connId: ws.data.connId,
      countedMapKindsByConnId: ctx.countedMapKindsByConnId,
      countedMapCountsByMatchPlayer: ctx.countedMapCountsByMatchPlayer,
      playerId,
      msg,
    });
    ws.data.lastSeqByPlayer.set(playerId, { seq: msg.seq, result: res });
    sendJson(ws, { type: 'ack', serverNow: Date.now(), seq: msg.seq, result: res });
    return;
  }

  if (msg.type === 'update_profile' || msg.type === 'update_audio_preferences') {
    if (msg.type === 'update_profile') handleProfileEdit(ctx, ws, msg, playerId);
    else handleAudioPreferences(ctx, ws, msg, playerId);
    return;
  }

  const mappedResult = dispatchEngineClientMessage(ctx.shell, playerId, msg);
  ws.data.lastSeqByPlayer.set(playerId, { seq: msg.seq, result: mappedResult });
  sendJson(ws, { type: 'ack', serverNow: Date.now(), seq: msg.seq, result: mappedResult });
}

function routeRawWsMessage(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  raw: string | Buffer,
): void {
  const byteLen = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength;
  if (byteLen > MAX_WS_MESSAGE_BYTES) {
    ws.close(1009, 'message_too_large');
    return;
  }
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return;
  }
  const parsed = clientMessageSchema.safeParse(parsedJson);
  if (!parsed.success) {
    if (
      typeof parsedJson === 'object' &&
      parsedJson !== null &&
      'type' in parsedJson &&
      parsedJson.type === 'profile_login'
    ) {
      if (ws.data.authenticated) ws.close(4004, 'already_authenticated');
      else {
        ctx.rateLimiter.recordAuthFailure(ws.data.ip);
        profileError(ws, 'invalid_profile_token');
      }
    }
    return;
  }

  const msg = parsed.data;
  if (msg.type === 'profile_login') {
    handleProfileLogin(ctx, ws, msg.profileToken);
    return;
  }
  if (msg.type === 'hello') {
    handleHelloMsg(ctx, ws, msg);
    return;
  }
  if (!ws.data.authenticated) {
    ws.close(4001, 'unauthorized');
    return;
  }
  if (msg.type === 'ping') {
    sendJson(ws, { type: 'pong', serverNow: Date.now(), clientNow: msg.clientNow });
    return;
  }
  if (msg.type === 'join') {
    handleJoinMsg(ctx, ws, msg);
    return;
  }
  if (ws.data.playerId) handleAuthenticatedAction(ctx, ws, msg, ws.data.playerId);
}

export function createWsRoomCoordinator(opts: {
  shell: RoomShell;
  profiles: ProfileStore;
  hostToken: string;
  guestToken: string;
  browserMapsKey: string | null;
  fakeMode: boolean;
  quotaManager: QuotaManager;
  rateLimiter: RateLimiter;
  botRunner?: BotRunner;
}): WsRoomCoordinator {
  const sockets = new Set<ServerWebSocket<WsClientData>>();
  const pendingSince = new Map<ServerWebSocket<WsClientData>, number>();
  const inflightVisionChecks = new Set<string>();
  const countedPanoKeys = new Set<string>();
  const countedMapKindsByConnId = new Map<string, Set<string>>();
  const countedMapCountsByMatchPlayer = new Map<string, number>();
  const versionRef = { value: 1 };

  const broadcastState = (): void => {
    versionRef.value += 1;
    const now = Date.now();
    for (const s of sockets) {
      if (!s.data.authenticated) continue;
      sendJson(s, {
        type: 'state',
        serverNow: now,
        version: versionRef.value,
        view: opts.shell.getView(s.data.playerId ?? '__unjoined__'),
      });
    }
  };

  const ctx: CoordCtx = {
    ...opts,
    profiles: opts.profiles,
    sockets,
    inflightVisionChecks,
    countedPanoKeys,
    countedMapKindsByConnId,
    countedMapCountsByMatchPlayer,
    versionRef,
    broadcastState,
  };

  return {
    canAcceptUpgrade: (ip) => checkUpgradeCapacity(sockets, pendingSince, opts.rateLimiter, ip),
    openSocket(ws) {
      sockets.add(ws);
      pendingSince.set(ws, Date.now());
      ws.data.authTimer = scheduleUnauthClose(ws, opts.rateLimiter);
    },
    closeSocket(ws) {
      if (ws.data.authTimer) clearTimeout(ws.data.authTimer);
      sockets.delete(ws);
      pendingSince.delete(ws);
      countedMapKindsByConnId.delete(ws.data.connId);
      if (ws.data.playerId)
        opts.shell.dispatch({ type: 'player_disconnect', playerId: ws.data.playerId });
    },
    handleRawMessage: (ws, raw) => {
      routeRawWsMessage(ctx, ws, raw);
    },
    broadcastState,
    closeAll() {
      for (const s of sockets) {
        if (s.data.authTimer) clearTimeout(s.data.authTimer);
        s.close(1001, 'server_shutdown');
      }
      sockets.clear();
      countedMapKindsByConnId.clear();
    },
  };
}

export type { RoomState };
