import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import {
  MAX_HUMANS,
  MAX_NICK_LEN,
  MAX_WS_MESSAGE_BYTES,
  clientMessageSchema,
  type AckResult,
  type ClientMessage,
  type ServerMessage,
} from '../../shared/protocol.ts';
import type { BotRunner } from '../bots/runner.ts';
import type { RoomShell } from '../engine/shell.ts';
import { computeLobbySummary, type RoomState } from '../engine/types.ts';
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
  authTimer: ReturnType<typeof setTimeout> | null;
  /** When hello succeeded; used to evict sockets that authenticate but never join. */
  authenticatedAt: number | null;
  lastSeqByPlayer: Map<string, { seq: number; result: AckResult }>;
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

function safeTokenMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

function sendJson(ws: ServerWebSocket<WsClientData>, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket closed mid-send.
  }
}

interface CoordCtx {
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

function closePreviousTabForPlayer(
  ctx: CoordCtx,
  playerId: string,
  current: ServerWebSocket<WsClientData>,
): void {
  for (const s of ctx.sockets) {
    if (s !== current && s.data.playerId === playerId) {
      sendJson(s, {
        type: 'hello_error',
        serverNow: Date.now(),
        code: 'replaced_by_new_tab',
        message: 'Открыта новая вкладка с вашим профилем.',
      });
      s.data.playerId = null;
      s.close(4002, 'replaced_by_new_tab');
    }
  }
}

function handleHelloMsg(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: Extract<ClientMessage, { type: 'hello' }>,
): void {
  if (ws.data.authenticated) {
    // A second hello would switch role/playerId and leak the previous player as connected.
    ws.close(4004, 'already_authenticated');
    return;
  }
  const isHostTok = safeTokenMatch(msg.token, ctx.hostToken);
  const isGuestTok = safeTokenMatch(msg.token, ctx.guestToken);
  if (!isHostTok && !isGuestTok) {
    ctx.rateLimiter.recordAuthFailure(ws.data.ip);
    const blocked = ctx.rateLimiter.isBlocked(ws.data.ip);
    if (ws.data.authTimer) {
      clearTimeout(ws.data.authTimer);
      ws.data.authTimer = null;
    }
    if (blocked) {
      ws.close(1008, '');
      return;
    }
    sendJson(ws, {
      type: 'hello_error',
      serverNow: Date.now(),
      code: 'invalid_token',
      message: 'Недействительная ссылка приглашения.',
    });
    ws.close(4003, 'invalid_token');
    return;
  }

  if (ws.data.authTimer) {
    clearTimeout(ws.data.authTimer);
    ws.data.authTimer = null;
  }
  ws.data.role = isHostTok ? 'host' : 'guest';

  const state = ctx.shell.getState();
  let restoredId: string | undefined;
  if (msg.playerId && msg.playerSecret) {
    const existing = state.players[msg.playerId];
    if (existing && safeTokenMatch(msg.playerSecret, existing.secret)) {
      restoredId = existing.id;
      ws.data.playerId = existing.id;
      closePreviousTabForPlayer(ctx, existing.id, ws);
      ctx.shell.dispatch({
        type: 'player_reconnect',
        playerId: existing.id,
        isHost: isHostTok,
        profileId: msg.profileId,
      });
    }
  }

  sendJson(ws, {
    type: 'hello_ok',
    serverNow: Date.now(),
    role: ws.data.role,
    browserMapsKey: ctx.browserMapsKey,
    fakeMode: ctx.fakeMode,
    restoredPlayerId: restoredId,
    restoredProfileId: restoredId ? ctx.shell.getState().players[restoredId]?.profileId : undefined,
    lobbySummary: computeLobbySummary(ctx.shell.getState()),
  });
  ws.data.authenticated = true;
  ws.data.authenticatedAt = Date.now();
  sendJson(ws, {
    type: 'state',
    serverNow: Date.now(),
    version: ++ctx.versionRef.value,
    view: ctx.shell.getView(restoredId ?? '__unjoined__'),
  });
}

function checkNewJoinEligibility(
  state: RoomState,
  color: Extract<ClientMessage, { type: 'join' }>['color'],
  role: 'host' | 'guest' | null,
): { ok: true } | { ok: false; code: 'color_taken' | 'room_full'; message: string } {
  const colorTakenByHuman = state.playerOrder.some((id) => state.players[id]?.color === color);
  const colorTakenByBot = state.settings.bots.some((b) => b.color === color);
  if (colorTakenByHuman || colorTakenByBot) {
    return {
      ok: false,
      code: 'color_taken',
      message: 'Этот цвет уже выбран другим участником.',
    };
  }
  const hasHost = state.playerOrder.some((id) => state.players[id]?.isHost);
  const maxForRole = role !== 'host' && !hasHost ? MAX_HUMANS - 1 : MAX_HUMANS;
  if (state.playerOrder.length >= maxForRole) {
    return {
      ok: false,
      code: 'room_full',
      message: 'Комната заполнена (максимум 8 игроков).',
    };
  }
  return { ok: true };
}

function botNameTaken(state: RoomState, nick: string): boolean {
  return state.settings.bots.some((b) => b.name.trim().toLowerCase() === nick.toLowerCase());
}

function handleJoinMsg(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: Extract<ClientMessage, { type: 'join' }>,
): void {
  if (ws.data.playerId) return;
  const state = ctx.shell.getState();
  const cleanNick = msg.nick.trim();
  const sendJoinErr = (
    code: 'nick_taken' | 'color_taken' | 'room_full' | 'bad_nick',
    message: string,
  ): void => {
    sendJson(ws, {
      type: 'join_error',
      serverNow: Date.now(),
      seq: msg.seq,
      code,
      message,
      lobbySummary: computeLobbySummary(state),
    });
  };

  if (!cleanNick || cleanNick.length > MAX_NICK_LEN) {
    sendJoinErr('bad_nick', `Имя должно быть от 1 до ${MAX_NICK_LEN} символов.`);
    return;
  }
  const existingByNick = state.playerOrder
    .map((id) => state.players[id])
    .find((p) => p && p.name.toLowerCase() === cleanNick.toLowerCase());

  if ((!existingByNick && botNameTaken(state, cleanNick)) || existingByNick?.connected) {
    sendJoinErr('nick_taken', 'Этот ник уже занят в текущей комнате.');
    return;
  }
  // A disconnected guest returns via hello with the playerSecret saved in their browser.
  // Taking the seat by nick alone is allowed only to the host-token holder for the host seat.
  if (existingByNick && !(existingByNick.isHost && ws.data.role === 'host')) {
    sendJoinErr(
      'nick_taken',
      'Этот ник принадлежит отключившемуся игроку. Вернуться под ним можно из того же браузера.',
    );
    return;
  }

  if (!existingByNick) {
    const elig = checkNewJoinEligibility(state, msg.color, ws.data.role);
    if (!elig.ok) {
      sendJoinErr(elig.code, elig.message);
      return;
    }
  }

  const playerId = existingByNick ? existingByNick.id : randomBytes(8).toString('hex');
  const playerSecret = randomBytes(16).toString('hex');
  ws.data.playerId = playerId;
  if (existingByNick) closePreviousTabForPlayer(ctx, playerId, ws);
  sendJson(ws, { type: 'join_ok', serverNow: Date.now(), playerId, playerSecret });

  if (existingByNick) {
    ctx.shell.dispatch({
      type: 'player_reclaim_nick',
      profileId: msg.profileId,
      playerId,
      oldPlayerId: existingByNick.id,
      newSecret: playerSecret,
      isHost: ws.data.role === 'host',
    });
  } else {
    ctx.shell.dispatch({
      type: 'player_join',
      playerId,
      secret: playerSecret,
      name: cleanNick,
      profileId: msg.profileId,
      color: msg.color,
      isHost: ws.data.role === 'host',
    });
  }
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
  if (msg.type === 'join' || msg.type === 'hello') return;

  const prev = ws.data.lastSeqByPlayer.get(playerId);
  if (prev && msg.seq <= prev.seq) {
    sendJson(ws, { type: 'ack', serverNow: Date.now(), seq: msg.seq, result: prev.result });
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
        ws.data.lastSeqByPlayer.set(playerId, { seq: msg.seq, result });
        sendJson(ws, { type: 'ack', serverNow: Date.now(), seq: msg.seq, result });
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
  if (!parsed.success) return;

  const msg = parsed.data;
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
