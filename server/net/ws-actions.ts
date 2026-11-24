import type { ServerWebSocket } from 'bun';
import {
  MAX_PENDING_AUTH_CONNECTIONS,
  MAX_WS_CONNECTIONS,
  UNAUTH_TIMEOUT_MS,
  type AckResult,
  type ClientMessage,
  type ServerMessage,
} from '../../shared/protocol.ts';
import { visionSubject } from '../../shared/play-style.ts';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { BotRunner } from '../bots/runner.ts';
import type { RoomShell } from '../engine/shell.ts';
import { buildQuotaSummaryForRoom, type QuotaManager } from '../storage/quota.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { WsClientData } from './ws.ts';

function syncQuotaToShell(shell: RoomShell, quotaManager: QuotaManager): void {
  const st = shell.getState();
  const botMoveLimits = st.settings.bots.filter((b) => b.enabled).map((b) => b.moveLimit);
  const quotaSummary = buildQuotaSummaryForRoom(quotaManager, {
    rounds: st.settings.rounds,
    humanCount: st.playerOrder.length,
    botMoveLimits,
  });
  const quotaWarning = quotaManager.needsResetConfirm()
    ? (quotaManager.hasWriteError() ??
      'Расход за месяц неизвестен: файл квоты повреждён. Сверьте расход в Cloud Console')
    : undefined;
  shell.dispatch({ type: 'quota_updated', quotaSummary, quotaWarning });
}

/** Validate and rate-limit per-match panorama loads before forwarding pano_loaded to RoomShell. */
export function handlePanoLoadedMsg(deps: {
  shell: RoomShell;
  quotaManager: QuotaManager;
  fakeMode: boolean;
  countedPanoKeys: Set<string>;
  playerId: string;
  msg: Extract<ClientMessage, { type: 'pano_loaded' }>;
}): AckResult {
  const { shell, quotaManager, fakeMode, countedPanoKeys, playerId, msg } = deps;
  const st = shell.getState();
  const player = st.players[playerId];
  if (!player) return 'forbidden';
  if (st.phase !== 'ROUND_LOADING' && st.phase !== 'ROUND_ACTIVE') {
    return st.phase === 'LOBBY' || st.phase === 'FINAL' ? 'invalid' : 'round_over';
  }
  if (msg.roundNumber !== st.roundNumber) {
    return 'round_over';
  }
  if (msg.countedLoad && !fakeMode && !player.isSpectator) {
    const matchKey = `${st.matchId}:${st.matchStartedAt ?? 'unstarted'}`;
    const panoKey = `${matchKey}:${msg.roundNumber}:${playerId}`;
    if (!countedPanoKeys.has(panoKey)) {
      countedPanoKeys.add(panoKey);
      quotaManager.recordPanoLoad(1);
      syncQuotaToShell(shell, quotaManager);
    }
  }
  return shell.dispatch({ type: 'pano_loaded', playerId, roundNumber: msg.roundNumber }) ?? 'ok';
}

/** Validate phase, deduplicate tab map loads, and cap per-match quota impact per player. */
export function handleMapLoadedMsg(deps: {
  shell: RoomShell;
  quotaManager: QuotaManager;
  fakeMode: boolean;
  connId: string;
  countedMapKindsByConnId: Map<string, Set<string>>;
  countedMapCountsByMatchPlayer: Map<string, number>;
  playerId: string;
  msg: Extract<ClientMessage, { type: 'map_loaded' }>;
}): AckResult {
  const {
    shell,
    quotaManager,
    fakeMode,
    connId,
    countedMapKindsByConnId,
    countedMapCountsByMatchPlayer,
    playerId,
    msg,
  } = deps;
  const st = shell.getState();
  if (!st.players[playerId] || st.phase === 'LOBBY') {
    return 'invalid';
  }
  if (!fakeMode) {
    let connKinds = countedMapKindsByConnId.get(connId);
    if (!connKinds) {
      connKinds = new Set();
      countedMapKindsByConnId.set(connId, connKinds);
    }
    const matchKey = `${st.matchId}:${st.matchStartedAt ?? 'unstarted'}`;
    const mpKey = `${matchKey}:${playerId}`;
    const used = countedMapCountsByMatchPlayer.get(mpKey) ?? 0;
    const cap = Math.max(2, st.settings.rounds * 2);
    if (!connKinds.has(msg.kind) && used < cap) {
      connKinds.add(msg.kind);
      countedMapCountsByMatchPlayer.set(mpKey, used + 1);
      quotaManager.recordMapLoad(1);
      syncQuotaToShell(shell, quotaManager);
    }
  }
  return 'ok';
}

export interface VisionCheckActionDeps {
  shell: RoomShell;
  botRunner?: BotRunner;
  inflightVisionChecks: Set<string>;
  playerId: string;
  msg: Extract<ClientMessage, { type: 'check_bot_vision' }>;
  sendAck: (result: AckResult) => void;
  onVisionResult?: (msg: Extract<ServerMessage, { type: 'vision_check_result' }>) => void;
}

/** The check tested one process (the eyes of a Detective): it counts while that one is unchanged. */
function sameVisionSubject(tested: BotSlotConfig, live: BotSlotConfig): boolean {
  const a = visionSubject(tested);
  const b = visionSubject(live);
  return (
    a.harness === b.harness &&
    a.model === b.model &&
    a.effort === b.effort &&
    tested.imageSize === live.imageSize
  );
}

/** Validate host authority, deduplicate in-flight checks per slot, and launch async vision check. */
export function handleVisionCheckMsg(deps: VisionCheckActionDeps): void {
  const { shell, botRunner, inflightVisionChecks, playerId, msg, sendAck, onVisionResult } = deps;
  const st = shell.getState();
  if (!st.players[playerId]?.isHost) {
    sendAck('forbidden');
    return;
  }
  const slot = st.settings.bots.find((b) => b.id === msg.botId);
  if (st.phase !== 'LOBBY' || !slot || !botRunner) {
    sendAck('invalid');
    return;
  }
  if (inflightVisionChecks.has(slot.id)) {
    sendAck('ok');
    return;
  }

  const snap = { ...slot };
  inflightVisionChecks.add(snap.id);
  sendAck('ok');
  void (async () => {
    let outcome: { passed: boolean; elapsedMs: number; message: string };
    try {
      outcome = await botRunner.runVisionCheck(snap);
    } catch (err) {
      outcome = {
        passed: false,
        elapsedMs: 0,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      inflightVisionChecks.delete(snap.id);
    }
    const cur = shell.getState();
    const live = cur.settings.bots.find((b) => b.id === snap.id);
    const tested = visionSubject(snap);
    if (cur.phase !== 'LOBBY' || !live || !sameVisionSubject(snap, live)) {
      onVisionResult?.({
        type: 'vision_check_result',
        serverNow: Date.now(),
        botId: snap.id,
        passed: false,
        elapsedMs: outcome.elapsedMs,
        message: 'Параметры слота изменились во время проверки',
      });
      return;
    }
    shell.dispatch({
      type: 'update_bot_vision_check',
      botId: snap.id,
      check: {
        passed: outcome.passed,
        elapsedMs: outcome.elapsedMs,
        model: tested.model,
        effort: tested.effort,
        imageSize: snap.imageSize,
        error: outcome.passed ? undefined : outcome.message,
        checkedAt: new Date().toISOString(),
      },
    });
    onVisionResult?.({
      type: 'vision_check_result',
      serverNow: Date.now(),
      botId: snap.id,
      passed: outcome.passed,
      elapsedMs: outcome.elapsedMs,
      message: outcome.message,
    });
  })().catch(() => {
    // Ignore dispatch errors if the room coordinator is shutting down.
  });
}

/** Map authenticated gameplay/lobby client messages onto RoomShell events. */
export function dispatchEngineClientMessage(
  shell: RoomShell,
  playerId: string,
  msg: ClientMessage,
): AckResult {
  switch (msg.type) {
    case 'reset_bot_wins':
      return shell.dispatch({ type: 'reset_bot_wins', playerId, botId: msg.botId }) ?? 'ok';
    case 'update_lobby':
      return shell.dispatch({ type: 'update_lobby', playerId, patch: msg.patch }) ?? 'ok';
    case 'add_bot':
      return shell.dispatch({ type: 'add_bot', playerId }) ?? 'ok';
    case 'remove_bot':
      return shell.dispatch({ type: 'remove_bot', playerId, botId: msg.botId }) ?? 'ok';
    case 'update_bot':
      return (
        shell.dispatch({ type: 'update_bot', playerId, botId: msg.botId, patch: msg.patch }) ?? 'ok'
      );
    case 'apply_bot_preset':
      return (
        shell.dispatch({
          type: 'apply_bot_preset',
          playerId,
          botId: msg.botId,
          preset: msg.preset,
        }) ?? 'ok'
      );
    case 'confirm_quota_reset':
      return shell.dispatch({ type: 'confirm_quota_reset', playerId }) ?? 'ok';
    case 'start_match':
      return shell.dispatch({ type: 'start_match', playerId }) ?? 'ok';
    case 'retry_round':
      return shell.dispatch({ type: 'retry_round', playerId, gen: msg.gen }) ?? 'ok';
    case 'client_error':
      return (
        shell.dispatch({
          type: 'client_error',
          playerId,
          source: msg.source,
          code: msg.code,
          message: msg.message,
        }) ?? 'ok'
      );
    case 'set_pin':
      return (
        shell.dispatch({
          type: 'set_pin',
          playerId,
          roundNumber: msg.roundNumber,
          lat: msg.lat,
          lng: msg.lng,
        }) ?? 'ok'
      );
    case 'submit_guess':
      return (
        shell.dispatch({
          type: 'submit_guess',
          playerId,
          roundNumber: msg.roundNumber,
          lat: msg.lat,
          lng: msg.lng,
        }) ?? 'ok'
      );
    case 'next_round':
      return shell.dispatch({ type: 'next_round', playerId, roundNumber: msg.roundNumber }) ?? 'ok';
    case 'end_match':
      return shell.dispatch({ type: 'end_match', playerId }) ?? 'ok';
    case 'play_again':
      return shell.dispatch({ type: 'play_again', playerId }) ?? 'ok';
    default:
      return 'invalid';
  }
}

const MAX_PENDING_PER_IP = 4;
/** Sockets that passed hello but never joined; beyond this the oldest one is evicted. */
export const MAX_UNJOINED_AUTHENTICATED = 8;

function evictOldestUnjoined(sockets: Set<ServerWebSocket<WsClientData>>): void {
  const unjoined = [...sockets].filter((s) => s.data.authenticated && !s.data.playerId);
  if (unjoined.length < MAX_UNJOINED_AUTHENTICATED) return;
  const oldest = unjoined.sort(
    (a, b) => (a.data.authenticatedAt ?? 0) - (b.data.authenticatedAt ?? 0),
  )[0];
  oldest?.close(4001, 'join_timeout');
}

/** Enforce room WS connection limits, per-IP unauth cap, and idle pending eviction. */
export function checkUpgradeCapacity(
  sockets: Set<ServerWebSocket<WsClientData>>,
  pendingSince: Map<ServerWebSocket<WsClientData>, number>,
  rateLimiter: RateLimiter,
  ip: string,
): { ok: true } | { ok: false; status: number; message: string } {
  if (rateLimiter.isIpBlocked(ip)) {
    return { ok: false, status: 429, message: 'Too many failed attempts' };
  }
  evictOldestUnjoined(sockets);
  if (sockets.size >= MAX_WS_CONNECTIONS) {
    return { ok: false, status: 503, message: 'Room connection limit reached' };
  }
  const now = Date.now();
  const pending = [...sockets].filter((s) => !s.data.authenticated);
  if (pending.length >= MAX_PENDING_AUTH_CONNECTIONS) {
    const idle = pending
      .map((s) => ({ s, age: now - (pendingSince.get(s) ?? now) }))
      .filter((x) => x.age >= 1_500)
      .sort((a, b) => b.age - a.age)[0];
    if (idle) {
      rateLimiter.recordAuthFailure(idle.s.data.ip);
      idle.s.close(4001, 'unauth_timeout');
    } else {
      return { ok: false, status: 429, message: 'Too many pending connections' };
    }
  }
  const pendingIp = [...sockets].filter((s) => !s.data.authenticated && s.data.ip === ip).length;
  if (pendingIp >= MAX_PENDING_PER_IP) {
    return { ok: false, status: 429, message: 'Too many pending connections' };
  }
  return { ok: true };
}

/** Close unauthenticated sockets after UNAUTH_TIMEOUT_MS and record auth failure. */
export function scheduleUnauthClose(
  ws: ServerWebSocket<WsClientData>,
  rateLimiter: RateLimiter,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (!ws.data.authenticated) {
      rateLimiter.recordAuthFailure(ws.data.ip);
      try {
        ws.send(
          JSON.stringify({
            type: 'hello_error',
            serverNow: Date.now(),
            code: 'unauth_timeout',
            message: 'Превышено время ожидания авторизации.',
          } satisfies ServerMessage),
        );
      } catch {
        // Socket already closed.
      }
      ws.close(4001, 'unauth_timeout');
    }
  }, UNAUTH_TIMEOUT_MS);
}
