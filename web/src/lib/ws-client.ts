import type { ParticipantColorId } from '$shared/colors';
import type { LobbySummary, ClientViewState, ServerMessage } from '$shared/protocol';
import { getOrCreateProfileId, loadSavedProfile, normalizeProfileToken } from './profile';
import { MapLoadReporter, type MapLoadKind } from './map-load-reports';

import {
  loadSavedCreds,
  saveCreds,
  clearCreds,
  extractAndStripInviteToken,
  clearStoredSessionToken,
  hasInviteFragment,
} from './ws-session-storage';
export {
  loadSavedCreds,
  saveCreds,
  clearCreds,
  extractAndStripInviteToken,
  clearStoredSessionToken,
} from './ws-session-storage';
export type { SavedPlayerCreds } from './ws-session-storage';
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;
const MAX_OFFLINE_BEFORE_ERROR_MS = 30_000;
const PING_INTERVAL_MS = 20_000;
const PIN_THROTTLE_MS = 200;

export interface OutgoingMessage {
  type: string;
  [key: string]: unknown;
}

export interface WsClientCallbacks {
  onNoToken: () => void;
  onProfileLoginOk?: (msg: Extract<ServerMessage, { type: 'profile_login_ok' }>) => void;
  onProfileLoginError?: (msg: Extract<ServerMessage, { type: 'profile_login_error' }>) => void;
  onHashToken?: () => void;
  onSocketConnecting: () => void;
  onSocketOpen: () => void;
  onBackOnline: () => void;
  onReconnecting: (attempt: number) => void;
  onReconnectTimeout: () => void;
  onPong: (serverNow: number, clientNow: number) => void;
  onHelloOk: (msg: Extract<ServerMessage, { type: 'hello_ok' }>) => void;
  onHelloError: (msg: Extract<ServerMessage, { type: 'hello_error' }>) => void;
  onJoinOk: (msg: Extract<ServerMessage, { type: 'join_ok' }>) => void;
  onJoinError: (msg: Extract<ServerMessage, { type: 'join_error' }>) => void;
  onAck: (msg: Extract<ServerMessage, { type: 'ack' }>) => void;
  onAvatarGesture: (msg: Extract<ServerMessage, { type: 'avatar_gesture' }>) => void;
  onVisionCheckResult: (msg: Extract<ServerMessage, { type: 'vision_check_result' }>) => void;
  onState: (msg: Extract<ServerMessage, { type: 'state' }>) => void;
  onSummaryUpdate?: (summary: LobbySummary) => void;
  /** A throttled (trailing) pin send found the socket closed. */
  onPinSendFailed?: () => void;
}

export class GeoWsClient {
  private readonly callbacks: WsClientCallbacks;
  private token: string | null = null;
  private profileToken: string | null = null;
  private ws: WebSocket | null = null;
  private seq = 1;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private pinTimer: number | null = null;
  private pendingPinPayload: { roundNumber: number; lat: number; lng: number } | null = null;
  private attempt = 0;
  private disconnectedSince: number | null = null;
  private wasAuthenticatedOnce = false;
  private intentionallyClosed = false;
  private fatalStop = false;
  private browserOffline = false;
  private listenersAttached = false;
  private readonly mapLoads = new MapLoadReporter((kind) =>
    this.sendSequenced('map_loaded', { kind }),
  );

  constructor(callbacks: WsClientCallbacks) {
    this.callbacks = callbacks;
  }

  private readonly handleOffline = (): void => {
    this.browserOffline = true;
    this.detachSocket();
    if (!this.intentionallyClosed && !this.fatalStop && (this.token || this.profileToken)) {
      this.scheduleReconnect();
    }
  };

  private readonly handleOnline = (): void => {
    this.browserOffline = false;
    if (
      !this.intentionallyClosed &&
      !this.fatalStop &&
      (this.token || this.profileToken) &&
      !this.isOpen()
    ) {
      this.clearReconnectTimer();
      this.openSocket();
    }
  };

  private readonly handleHashChange = (): void => {
    if (window.location.hash.length <= 1 || !hasInviteFragment()) {
      return;
    }
    const nextToken = extractAndStripInviteToken();
    if (!nextToken) return;
    if (this.wasAuthenticatedOnce || this.profileToken) return;
    this.token = nextToken;
    this.intentionallyClosed = false;
    this.fatalStop = false;
    this.attempt = 0;
    this.disconnectedSince = null;
    this.wasAuthenticatedOnce = false;
    this.mapLoads.reset();
    this.clearTimers();
    this.detachSocket();
    this.callbacks.onHashToken?.();
    if (this.browserOffline || !window.navigator.onLine) {
      this.scheduleReconnect();
      return;
    }
    this.openSocket();
  };

  private attachBrowserListeners(): void {
    if (this.listenersAttached || typeof window === 'undefined') return;
    this.listenersAttached = true;
    this.browserOffline = !window.navigator.onLine;
    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('hashchange', this.handleHashChange);
  }

  private detachBrowserListeners(): void {
    if (!this.listenersAttached || typeof window === 'undefined') return;
    this.listenersAttached = false;
    window.removeEventListener('offline', this.handleOffline);
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('hashchange', this.handleHashChange);
  }

  private detachSocket(): void {
    const prev = this.ws;
    this.ws = null;
    this.clearPingLoop();
    if (prev) prev.close();
  }

  sendMapLoadedOnce(kind: MapLoadKind): void {
    this.mapLoads.report(kind);
  }

  /** Re-sends map loads reported while the socket was down; call once the room is past the lobby. */
  flushPendingMapLoads(): void {
    this.mapLoads.flushPending();
  }

  start(): void {
    this.attachBrowserListeners();
    this.intentionallyClosed = false;
    this.fatalStop = false;
    if (!this.token) {
      this.token = extractAndStripInviteToken();
    }
    this.profileToken ??= loadSavedProfile()?.profileToken ?? null;
    if (!this.token && !this.profileToken) {
      this.callbacks.onNoToken();
      return;
    }
    this.openSocket();
  }

  login(raw: string): void {
    if (this.wasAuthenticatedOnce && this.profileToken) return;
    this.close();
    this.wasAuthenticatedOnce = false;
    this.token = null;
    this.profileToken = normalizeProfileToken(raw) ?? raw;
    this.retry();
  }

  useCodeLogin(): void {
    this.close();
    this.token = null;
    this.profileToken = null;
    this.wasAuthenticatedOnce = false;
    clearStoredSessionToken();
    this.attachBrowserListeners();
    this.callbacks.onNoToken();
  }

  logout(clearShared = true): void {
    this.close();
    this.token = null;
    this.profileToken = null;
    this.wasAuthenticatedOnce = false;
    this.pendingPinPayload = null;
    this.mapLoads.reset();
    if (clearShared) clearCreds();
    clearStoredSessionToken();
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  retry(): void {
    this.disconnectedSince = null;
    this.attempt = 0;
    this.fatalStop = false;
    this.clearReconnectTimer();
    this.start();
  }

  close(): void {
    this.intentionallyClosed = true;
    this.detachBrowserListeners();
    this.clearTimers();
    this.detachSocket();
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  sendRaw(payload: Record<string, unknown>): boolean {
    if (!this.isOpen() || !this.ws) {
      return false;
    }
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  sendSequencedWithSeq(
    type: string,
    fields: Record<string, unknown> = {},
  ): { sent: boolean; seq: number } {
    const seq = this.nextSeq();
    const sent = this.sendRaw({ type, seq, ...fields });
    return { sent, seq };
  }

  sendSequenced(type: string, fields: Record<string, unknown> = {}): boolean {
    return this.sendSequencedWithSeq(type, fields).sent;
  }

  clearPendingPin(): void {
    this.clearPinTimer();
    this.pendingPinPayload = null;
  }

  sendJoin(nick: string, color: ParticipantColorId, profileId?: string): boolean {
    return this.sendSequenced('join', { nick, color, profileId });
  }

  sendPinThrottled(roundNumber: number, lat: number, lng: number): boolean {
    if (!this.isOpen()) {
      return false;
    }
    this.pendingPinPayload = { roundNumber, lat, lng };
    if (this.pinTimer === null) {
      this.flushPin();
      this.pinTimer = window.setTimeout(() => {
        this.pinTimer = null;
        if (this.pendingPinPayload) {
          this.flushPin();
        }
      }, PIN_THROTTLE_MS);
    }
    return true;
  }

  sendGuess(roundNumber: number, lat: number, lng: number): boolean {
    this.clearPendingPin();
    return this.sendSequenced('submit_guess', { roundNumber, lat, lng });
  }

  private flushPin(): void {
    if (!this.pendingPinPayload) return;
    const payload = this.pendingPinPayload;
    this.pendingPinPayload = null;
    if (!this.sendSequenced('set_pin', payload)) this.callbacks.onPinSendFailed?.();
  }

  private openSocket(): void {
    this.clearReconnectTimer();
    if (!this.token && !this.profileToken) return;
    if (this.browserOffline || !window.navigator.onLine) {
      this.browserOffline = true;
      this.scheduleReconnect();
      return;
    }
    this.callbacks.onSocketConnecting();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.disconnectedSince = null;
      this.callbacks.onSocketOpen();
      const saved = loadSavedCreds();
      ws.send(
        JSON.stringify(
          this.profileToken
            ? { type: 'profile_login', profileToken: this.profileToken }
            : {
                type: 'hello',
                profileId: getOrCreateProfileId(),
                token: this.token,
                ...(saved ? { playerId: saved.playerId, playerSecret: saved.playerSecret } : {}),
              },
        ),
      );
      this.startPingLoop();
    });

    ws.addEventListener('message', (event) => {
      if (this.ws !== ws || typeof event.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        // Ignore malformed server payload.
        return;
      }
      // Kept outside the try block: an exception in a message handler is a bug and must stay visible.
      this.handleMessage(msg);
    });

    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return;
      if ([4002, 4003, 4004].includes(event.code)) this.fatalStop = true;
      this.ws = null;
      this.clearPingLoop();
      if (!this.intentionallyClosed && !this.fatalStop) {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      // Close event handles reconnect scheduling consistently.
    });
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'pong':
        this.callbacks.onPong(msg.serverNow, msg.clientNow);
        break;
      case 'profile_login_ok':
        if (this.wasAuthenticatedOnce) this.callbacks.onBackOnline();
        this.wasAuthenticatedOnce = true;
        this.profileToken = msg.profile.profileToken;
        saveCreds({ playerId: msg.playerId, playerSecret: msg.playerSecret });
        this.callbacks.onProfileLoginOk?.(msg);
        break;
      case 'profile_login_error':
        this.fatalStop = true;
        this.callbacks.onProfileLoginError?.(msg);
        break;
      case 'hello_ok':
        if (this.wasAuthenticatedOnce) {
          this.callbacks.onBackOnline();
        }
        this.wasAuthenticatedOnce = true;
        if (!msg.restoredPlayerId) {
          clearCreds();
        }
        if (msg.profile) this.profileToken = msg.profile.profileToken;
        this.callbacks.onHelloOk(msg);
        break;
      case 'hello_error':
        if (msg.code === 'invalid_token') {
          clearCreds();
          clearStoredSessionToken();
          this.fatalStop = true;
        } else if (msg.code === 'replaced_by_new_tab') {
          this.fatalStop = true;
        }
        this.callbacks.onHelloError(msg);
        break;
      case 'join_ok':
        this.profileToken = msg.profile.profileToken;
        saveCreds({ playerId: msg.playerId, playerSecret: msg.playerSecret });
        this.callbacks.onJoinOk(msg);
        break;
      case 'join_error':
        if (msg.code === 'profile_token_required' || msg.code === 'profile_store_unavailable')
          this.fatalStop = true;
        this.callbacks.onJoinError(msg);
        break;
      case 'ack':
        this.callbacks.onAck(msg);
        break;
      case 'avatar_gesture':
        this.callbacks.onAvatarGesture(msg);
        break;
      case 'vision_check_result':
        this.callbacks.onVisionCheckResult(msg);
        break;
      case 'state':
        this.callbacks.onState(msg);
        break;
    }
  }

  private startPingLoop(): void {
    this.clearPingLoop();
    this.sendRaw({ type: 'ping', clientNow: Date.now() });
    this.pingTimer = window.setInterval(() => {
      this.sendRaw({ type: 'ping', clientNow: Date.now() });
    }, PING_INTERVAL_MS);
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const now = Date.now();
    this.disconnectedSince ??= now;
    if (now - this.disconnectedSince >= MAX_OFFLINE_BEFORE_ERROR_MS) {
      this.callbacks.onReconnectTimeout();
      return;
    }
    const idx = Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[idx] ?? 10_000;
    this.attempt += 1;
    this.callbacks.onReconnecting(this.attempt);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.browserOffline || !window.navigator.onLine) {
        this.scheduleReconnect();
        return;
      }
      this.openSocket();
    }, delay);
  }

  private clearPingLoop(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPinTimer(): void {
    if (this.pinTimer !== null) {
      window.clearTimeout(this.pinTimer);
      this.pinTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearPingLoop();
    this.clearReconnectTimer();
    this.clearPinTimer();
    this.pendingPinPayload = null;
  }
}

export type { ClientViewState };
