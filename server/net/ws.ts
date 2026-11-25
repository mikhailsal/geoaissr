import {
  sendJson,
  handleHelloMsg,
  handleJoinMsg,
  handleProfileLogin,
  profileError,
  handleProfileEdit,
} from './ws-auth.ts';
import type { ServerWebSocket } from 'bun';
import { pruneAvatarTurns, relayAvatarGesture } from './avatar-gestures.ts';
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

type DurableAction = 'update_profile' | 'update_audio_preferences' | 'bot_appearance';
type AckRecord = {
  seq: number;
  result: AckResult;
  commandType?: DurableAction;
  message?: string;
  retryAfterMs?: number;
};
type AuthenticatedAction = Exclude<
  ClientMessage,
  { type: 'ping' | 'join' | 'hello' | 'profile_login' }
>;

export interface WsClientData {
  connId: string;
  lastGestureAt?: number;
  spinBudgetAt?: number;
  turnBudgetAt?: number;
  ip: string;
  authenticated: boolean;
  role: 'host' | 'guest' | null;
  playerId: string | null;
  profileId?: string | null;
  authTimer: ReturnType<typeof setTimeout> | null;
  /** When hello succeeded; used to evict sockets that authenticate but never join. */
  authenticatedAt: number | null;
  pendingAction?: Promise<void>;
  pendingActionCount?: number;
  pendingProfileEnrollment?: boolean;
  lastSeqByPlayer: Map<string, AckRecord>;
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
  avatarTurns: Map<string, number>;
  inflightVisionChecks: Set<string>;
  countedPanoKeys: Set<string>;
  countedMapKindsByConnId: Map<string, Set<string>>;
  countedMapCountsByMatchPlayer: Map<string, number>;
  pendingJoinRoles: Map<ServerWebSocket<WsClientData>, 'host' | 'guest' | null>;
  versionRef: { value: number };
  broadcastState: () => void;
}

/** Keep acknowledgements from delayed work from moving the replay watermark backwards. */
function acknowledgeAction(
  ws: ServerWebSocket<WsClientData>,
  playerId: string,
  seq: number,
  result: AckResult,
  commandType?: DurableAction,
  message?: string,
  retryAfterMs?: number,
): void {
  const previous = ws.data.lastSeqByPlayer.get(playerId);
  if (!previous || seq >= previous.seq)
    ws.data.lastSeqByPlayer.set(playerId, { seq, result, commandType, message, retryAfterMs });
  sendJson(ws, { type: 'ack', serverNow: Date.now(), seq, result, message, retryAfterMs });
}

function replayAction(
  ws: ServerWebSocket<WsClientData>,
  playerId: string,
  seq: number,
  durableType: DurableAction | undefined,
): boolean {
  const prev = ws.data.lastSeqByPlayer.get(playerId);
  if (!prev || seq > prev.seq) return false;
  const result =
    durableType && (prev.seq !== seq || prev.commandType !== durableType) ? 'invalid' : prev.result;
  sendJson(ws, {
    type: 'ack',
    serverNow: Date.now(),
    seq,
    result,
    message: result === prev.result ? prev.message : undefined,
    retryAfterMs: result === prev.result ? prev.retryAfterMs : undefined,
  });
  return true;
}

function durableActionType(msg: AuthenticatedAction): DurableAction | undefined {
  if (msg.type === 'update_profile' || msg.type === 'update_audio_preferences') return msg.type;
  return msg.type === 'update_bot' && msg.patch.avatar !== undefined ? 'bot_appearance' : undefined;
}

function handleAuthenticatedAction(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: AuthenticatedAction,
  playerId: string,
): void | Promise<void> {
  const botAppearance = msg.type === 'update_bot' && msg.patch.avatar !== undefined;

  if (botAppearance) {
    return ctx.shell.saveBotAppearance({ ...msg, playerId }).then((result) => {
      acknowledgeAction(ws, playerId, msg.seq, result, 'bot_appearance');
    });
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
    acknowledgeAction(ws, playerId, msg.seq, res);
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
    acknowledgeAction(ws, playerId, msg.seq, res);
    return;
  }

  if (msg.type === 'update_profile' || msg.type === 'update_audio_preferences') {
    return msg.type === 'update_profile'
      ? handleProfileEdit(ctx, ws, msg, playerId)
      : handleAudioPreferences(ctx, ws, msg, playerId);
  }

  const mappedResult =
    msg.type === 'avatar_gesture' || msg.type === 'avatar_spin' || msg.type === 'avatar_turn'
      ? relayAvatarGesture(ctx, ws, playerId, msg)
      : dispatchEngineClientMessage(ctx.shell, playerId, msg);
  acknowledgeAction(ws, playerId, msg.seq, mappedResult);
}

// Keep durable acknowledgements and later gameplay actions in receive order on each socket.
function dispatchOrderedAction(
  ctx: CoordCtx,
  ws: ServerWebSocket<WsClientData>,
  msg: AuthenticatedAction,
  playerId: string,
): void {
  const durableType = durableActionType(msg);
  if (replayAction(ws, playerId, msg.seq, durableType)) return;
  if ((ws.data.pendingActionCount ?? 0) >= 16) {
    ws.close(1008, 'too_many_pending_actions');
    return;
  }
  const profileId = ws.data.profileId;
  const profileWrite = msg.type === 'update_profile' || msg.type === 'update_audio_preferences';
  const limited = profileWrite && profileId && !ctx.profiles.admitWrite(profileId);
  const retryAfterMs = limited ? ctx.profiles.writeRetryAfterMs(profileId) : undefined;
  const run = () => {
    if (ws.data.playerId !== playerId || !ctx.sockets.has(ws)) return;
    if (replayAction(ws, playerId, msg.seq, durableType)) return;
    if (limited) {
      acknowledgeAction(
        ws,
        playerId,
        msg.seq,
        'rate_limited',
        durableType,
        'Слишком много изменений. Повторите через пару секунд.',
        retryAfterMs,
      );
      return;
    }
    return handleAuthenticatedAction(ctx, ws, msg, playerId);
  };
  const prior = ws.data.pendingAction;
  const pending = prior ? prior.then(run) : run();
  if (!pending) return;
  ws.data.pendingAction = pending;
  ws.data.pendingActionCount = (ws.data.pendingActionCount ?? 0) + 1;
  const clear = () => {
    if (ws.data.pendingAction === pending) delete ws.data.pendingAction;
    ws.data.pendingActionCount = (ws.data.pendingActionCount ?? 1) - 1;
  };
  void pending.then(clear, clear);
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
    handleProfileLogin(ctx, ws, msg);
    return;
  }
  if (msg.type === 'hello') {
    void handleHelloMsg(ctx, ws, msg);
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
    void handleJoinMsg(ctx, ws, msg);
    return;
  }
  if (ws.data.playerId) dispatchOrderedAction(ctx, ws, msg, ws.data.playerId);
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
  const pendingJoinRoles = new Map<ServerWebSocket<WsClientData>, 'host' | 'guest' | null>();
  const versionRef = { value: 1 };
  const avatarTurns = new Map<string, number>();

  const broadcastState = (): void => {
    pruneAvatarTurns(avatarTurns, opts.shell.getState());
    versionRef.value += 1;
    const now = Date.now();
    for (const s of sockets) {
      if (!s.data.authenticated || s.data.pendingProfileEnrollment) continue;
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
    avatarTurns,
    inflightVisionChecks,
    countedPanoKeys,
    countedMapKindsByConnId,
    countedMapCountsByMatchPlayer,
    pendingJoinRoles,
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
