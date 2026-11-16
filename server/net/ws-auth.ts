import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import {
  MAX_HUMANS,
  MAX_NICK_LEN,
  type ClientMessage,
  type ServerMessage,
} from '../../shared/protocol.ts';
import type { StoredProfile } from '../../shared/storage-schemas.ts';
import { computeLobbySummary, type RoomState } from '../engine/types.ts';
import { handleProfileAction } from '../engine/profile.ts';
import type { CoordCtx, WsClientData } from './ws.ts';

function safeTokenMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

export function sendJson(ws: ServerWebSocket<WsClientData>, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket closed mid-send.
  }
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
      s.data.authenticated = false;
      s.data.profileId = null;
      s.data.role = null;
      s.close(4002, 'replaced_by_new_tab');
    }
  }
}

export const STORE_UNAVAILABLE = 'Профили временно недоступны. Попробуйте позже.';
function finishAuthentication(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  profile?: StoredProfile,
): void {
  if (ws.data.authTimer) clearTimeout(ws.data.authTimer);
  ws.data.authTimer = null;
  ws.data.authenticated = true;
  ws.data.authenticatedAt = Date.now();
  if (profile) {
    ws.data.profileId = profile.profileId;
    ws.data.role = profile.role;
  }
}
function sendState(ctx: CoordCtx, ws: ServerWebSocket<WsClientData>): void {
  sendJson(ws, {
    type: 'state',
    serverNow: Date.now(),
    version: ++ctx.versionRef.value,
    view: ctx.shell.getView(ws.data.playerId ?? '__unjoined__'),
  });
}
export function profileError(
  ws: ServerWebSocket<WsClientData>,
  code: 'invalid_profile_token' | 'room_full' | 'profile_store_unavailable',
): void {
  sendJson(ws, {
    type: 'profile_login_error',
    serverNow: Date.now(),
    code,
    message:
      code === 'profile_store_unavailable'
        ? STORE_UNAVAILABLE
        : code === 'room_full'
          ? 'Комната заполнена (максимум 8 игроков).'
          : 'Неверный код профиля.',
  });
  ws.close(4003, code);
}
function checkNewJoinEligibility(state: RoomState, role: 'host' | 'guest' | null): boolean {
  const hasHost = state.playerOrder.some((id) => state.players[id]?.isHost);
  return state.playerOrder.length < (role !== 'host' && !hasHost ? MAX_HUMANS - 1 : MAX_HUMANS);
}
export function handleProfileLogin(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  raw: string,
): void {
  if (ws.data.authenticated) {
    ws.close(4004, 'already_authenticated');
    return;
  }
  if (!ctx.profiles.isAvailable()) {
    profileError(ws, 'profile_store_unavailable');
    return;
  }
  const profile = ctx.profiles.getByToken(raw);
  if (!profile) {
    ctx.rateLimiter.recordAuthFailure(ws.data.ip);
    if (ctx.rateLimiter.isBlocked(ws.data.ip)) {
      ws.close(1008, '');
      return;
    }
    profileError(ws, 'invalid_profile_token');
    return;
  }
  const state = ctx.shell.getState();
  const seats = Object.values(state.players).filter((p) => p.profileId === profile.profileId);
  if (seats.length > 1 || (seats[0]?.isHost && profile.role !== 'host')) {
    profileError(ws, 'profile_store_unavailable');
    return;
  }
  const seat = seats[0];
  if (!seat && !checkNewJoinEligibility(state, profile.role)) {
    profileError(ws, 'room_full');
    return;
  }
  const playerId = seat?.id ?? randomBytes(8).toString('hex');
  const playerSecret = seat?.secret ?? randomBytes(16).toString('hex');
  ws.data.playerId = playerId;
  closePreviousTabForPlayer(ctx, playerId, ws);
  if (seat)
    ctx.shell.dispatch({
      type: 'player_reconnect',
      playerId,
      isHost: profile.role === 'host',
      profileId: profile.profileId,
    });
  else
    ctx.shell.dispatch({
      type: 'player_join',
      playerId,
      secret: playerSecret,
      profileId: profile.profileId,
      name: profile.nick,
      color: profile.color,
      isHost: profile.role === 'host',
    });
  finishAuthentication(ctx, ws, profile);
  sendJson(ws, {
    type: 'profile_login_ok',
    serverNow: Date.now(),
    profile,
    playerId,
    playerSecret,
    resumedSeat: Boolean(seat),
    browserMapsKey: ctx.browserMapsKey,
    fakeMode: ctx.fakeMode,
    lobbySummary: computeLobbySummary(ctx.shell.getState()),
  });
  sendState(ctx, ws);
}
function validInvitation(ctx: CoordCtx, ws: ServerWebSocket<WsClientData>, token: string): boolean {
  if (safeTokenMatch(token, ctx.hostToken) || safeTokenMatch(token, ctx.guestToken)) return true;
  ctx.rateLimiter.recordAuthFailure(ws.data.ip);
  if (ctx.rateLimiter.isBlocked(ws.data.ip)) {
    ws.close(1008, '');
    return false;
  }
  sendJson(ws, {
    type: 'hello_error',
    serverNow: Date.now(),
    code: 'invalid_token',
    message: 'Недействительная ссылка приглашения.',
  });
  ws.close(4003, 'invalid_token');
  return false;
}
export function handleHelloMsg(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: Extract<ClientMessage, { type: 'hello' }>,
): void {
  if (ws.data.authenticated) {
    ws.close(4004, 'already_authenticated');
    return;
  }
  const isHostTok = safeTokenMatch(msg.token, ctx.hostToken);
  if (!validInvitation(ctx, ws, msg.token)) return;
  ws.data.role = isHostTok ? 'host' : 'guest';
  const existing = msg.playerId ? ctx.shell.getState().players[msg.playerId] : undefined;
  let profile: StoredProfile | undefined;
  let restoredId: string | undefined;
  if (existing && msg.playerSecret && safeTokenMatch(msg.playerSecret, existing.secret)) {
    if (!ctx.profiles.isAvailable()) {
      profileError(ws, 'profile_store_unavailable');
      return;
    }
    const authoritativeId = existing.profileId ?? msg.profileId;
    if (!existing.profileId && msg.profileId && ctx.profiles.getById(msg.profileId)) {
      profileError(ws, 'profile_store_unavailable');
      return;
    }
    profile = authoritativeId ? ctx.profiles.getById(authoritativeId) : undefined;
    if (profile && existing.isHost && profile.role !== 'host') {
      profileError(ws, 'profile_store_unavailable');
      return;
    }
    if (
      authoritativeId &&
      Object.values(ctx.shell.getState().players).filter((p) => p.profileId === authoritativeId)
        .length > 1
    ) {
      profileError(ws, 'profile_store_unavailable');
      return;
    }
    if (!profile) {
      try {
        profile = ctx.profiles.create({
          profileId: authoritativeId,
          nick: existing.name,
          color: existing.color,
          role: ws.data.role,
        });
      } catch {
        profileError(ws, 'profile_store_unavailable');
        return;
      }
    }
    restoredId = existing.id;
    ws.data.playerId = existing.id;
    ws.data.role = profile.role;
    closePreviousTabForPlayer(ctx, existing.id, ws);
    ctx.shell.dispatch({
      type: 'player_reconnect',
      playerId: existing.id,
      isHost: profile.role === 'host',
      profileId: profile.profileId,
    });
  }
  finishAuthentication(ctx, ws, profile);
  sendJson(ws, {
    type: 'hello_ok',
    serverNow: Date.now(),
    role: ws.data.role,
    profile,
    browserMapsKey: ctx.browserMapsKey,
    fakeMode: ctx.fakeMode,
    restoredPlayerId: restoredId,
    restoredProfileId: profile?.profileId,
    lobbySummary: computeLobbySummary(ctx.shell.getState()),
  });
  sendState(ctx, ws);
}
export function handleJoinMsg(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: Extract<ClientMessage, { type: 'join' }>,
): void {
  if (ws.data.playerId) return;
  const state = ctx.shell.getState();
  const sendJoinErr = (
    code: Extract<ServerMessage, { type: 'join_error' }>['code'],
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
  if (!ctx.profiles.isAvailable()) {
    sendJoinErr('profile_store_unavailable', STORE_UNAVAILABLE);
    return;
  }
  if (msg.profileId && ctx.profiles.getById(msg.profileId)) {
    sendJoinErr(
      'profile_token_required',
      'Этот профиль уже зарегистрирован. Войдите по коду профиля на главной странице.',
    );
    return;
  }
  const nick = msg.nick.trim();
  if (!nick || nick.length > MAX_NICK_LEN) {
    sendJoinErr('bad_nick', 'Имя должно быть от 1 до 20 символов.');
    return;
  }
  if (!checkNewJoinEligibility(state, ws.data.role)) {
    sendJoinErr('room_full', 'Комната заполнена (максимум 8 игроков).');
    return;
  }
  let profile: StoredProfile;
  try {
    profile = ctx.profiles.create({
      profileId: msg.profileId,
      nick,
      color: msg.color,
      role: ws.data.role ?? 'guest',
    });
  } catch {
    sendJoinErr('profile_store_unavailable', STORE_UNAVAILABLE);
    return;
  }
  const playerId = randomBytes(8).toString('hex');
  const playerSecret = randomBytes(16).toString('hex');
  ws.data.playerId = playerId;
  ws.data.profileId = profile.profileId;
  ws.data.authenticated = false;
  ctx.shell.dispatch({
    type: 'player_join',
    playerId,
    secret: playerSecret,
    name: nick,
    profileId: profile.profileId,
    color: profile.color,
    isHost: profile.role === 'host',
  });
  ws.data.authenticated = true;
  sendJson(ws, { type: 'join_ok', serverNow: Date.now(), playerId, playerSecret, profile });
  sendState(ctx, ws);
}

export function handleProfileEdit(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: Extract<ClientMessage, { type: 'update_profile' }>,
  playerId: string,
): void {
  const event = { type: 'update_profile' as const, playerId, nick: msg.nick, color: msg.color };
  let result = handleProfileAction(ctx.shell.getState(), event, Date.now()).ack ?? 'ok';
  let message: string | undefined;
  if (result === 'ok') {
    try {
      if (!ws.data.profileId) throw new Error('Unavailable');
      ctx.profiles.edit(ws.data.profileId, msg.nick.trim(), msg.color);
      result = ctx.shell.dispatch(event) ?? 'ok';
    } catch {
      result = 'invalid';
      message = STORE_UNAVAILABLE;
    }
  }
  ws.data.lastSeqByPlayer.set(playerId, { seq: msg.seq, result });
  sendJson(ws, { type: 'ack', serverNow: Date.now(), seq: msg.seq, result, message });
  return;
}
