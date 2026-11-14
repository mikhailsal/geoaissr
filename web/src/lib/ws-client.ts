import type { ParticipantColorId } from '$shared/colors';
import type { LobbySummary, ClientViewState, ServerMessage } from '$shared/protocol';

const TOKEN_PARAM_RE = /(?:^|&)t=([^&]+)/;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;
const MAX_OFFLINE_BEFORE_ERROR_MS = 30_000;
const PING_INTERVAL_MS = 20_000;
const PIN_THROTTLE_MS = 200;

export interface SavedPlayerCreds {
  playerId: string;
  playerSecret: string;
}

export interface OutgoingMessage {
  type: string;
  [key: string]: unknown;
}

export interface WsClientCallbacks {
  onNoToken: () => void;
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
  onVisionCheckResult: (msg: Extract<ServerMessage, { type: 'vision_check_result' }>) => void;
  onState: (msg: Extract<ServerMessage, { type: 'state' }>) => void;
  onSummaryUpdate?: (summary: LobbySummary) => void;
  /** A throttled (trailing) pin send found the socket closed. */
  onPinSendFailed?: () => void;
}

function playerStorageKey(): string {
  return `geoaissr:player:${window.location.origin}`;
}

function tabTokenStorageKey(): string {
  return `geoaissr:tok:${window.location.origin}`;
}

export function loadSavedCreds(): SavedPlayerCreds | null {
  try {
    const raw = window.localStorage.getItem(playerStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPlayerCreds>;
    if (typeof parsed.playerId === 'string' && typeof parsed.playerSecret === 'string') {
      return { playerId: parsed.playerId, playerSecret: parsed.playerSecret };
    }
  } catch {
    // Ignore invalid storage payload
  }
  return null;
}

export function saveCreds(creds: SavedPlayerCreds): void {
  try {
    window.localStorage.setItem(playerStorageKey(), JSON.stringify(creds));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearCreds(): void {
  try {
    window.localStorage.removeItem(playerStorageKey());
  } catch {
    // Ignore storage errors
  }
}

export function extractAndStripInviteToken(): string | null {
  const hash = window.location.hash;
  if (hash.length > 1) {
    const match = TOKEN_PARAM_RE.exec(hash.slice(1));
    let token: string | null = null;
    if (match?.[1]) {
      try {
        token = decodeURIComponent(match[1]);
      } catch {
        token = null;
      }
    }
    if (token) {
      try {
        window.sessionStorage.setItem(tabTokenStorageKey(), token);
      } catch {
        // Ignore sessionStorage unavailable
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return token;
    }
  }
  try {
    return window.sessionStorage.getItem(tabTokenStorageKey());
  } catch {
    return null;
  }
}

export function clearStoredSessionToken(): void {
  try {
    window.sessionStorage.removeItem(tabTokenStorageKey());
  } catch {
    // Ignore
  }
}

export class GeoWsClient {
  private readonly callbacks: WsClientCallbacks;
  private token: string | null = null;
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
  private readonly sentMapKinds = new Set<'guess' | 'results'>();

  constructor(callbacks: WsClientCallbacks) {
    this.callbacks = callbacks;
  }

  private readonly handleOffline = (): void => {
    this.browserOffline = true;
    this.detachSocket();
    if (!this.intentionallyClosed && !this.fatalStop && this.token) {
      this.scheduleReconnect();
    }
  };

  private readonly handleOnline = (): void => {
    this.browserOffline = false;
    if (!this.intentionallyClosed && !this.fatalStop && this.token && !this.isOpen()) {
      this.clearReconnectTimer();
      this.openSocket();
    }
  };

  private readonly handleHashChange = (): void => {
    if (window.location.hash.length <= 1 || !TOKEN_PARAM_RE.test(window.location.hash.slice(1))) {
      return;
    }
    const nextToken = extractAndStripInviteToken();
    if (!nextToken) return;
    this.token = nextToken;
    this.intentionallyClosed = false;
    this.fatalStop = false;
    this.attempt = 0;
    this.disconnectedSince = null;
    this.wasAuthenticatedOnce = false;
    this.sentMapKinds.clear();
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

  sendMapLoadedOnce(kind: 'guess' | 'results'): void {
    if (this.sentMapKinds.has(kind)) return;
    this.sentMapKinds.add(kind);
    this.sendSequenced('map_loaded', { kind });
  }

  start(): void {
    this.attachBrowserListeners();
    this.intentionallyClosed = false;
    this.fatalStop = false;
    if (!this.token) {
      this.token = extractAndStripInviteToken();
    }
    if (!this.token) {
      this.callbacks.onNoToken();
      return;
    }
    this.openSocket();
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

  sendJoin(nick: string, color: ParticipantColorId): boolean {
    return this.sendSequenced('join', { nick, color });
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
    if (!this.token) return;
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
        JSON.stringify({
          type: 'hello',
          token: this.token,
          ...(saved ? { playerId: saved.playerId, playerSecret: saved.playerSecret } : {}),
        }),
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

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
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
      case 'hello_ok':
        if (this.wasAuthenticatedOnce) {
          this.callbacks.onBackOnline();
        }
        this.wasAuthenticatedOnce = true;
        if (!msg.restoredPlayerId) {
          clearCreds();
        }
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
        saveCreds({ playerId: msg.playerId, playerSecret: msg.playerSecret });
        this.callbacks.onJoinOk(msg);
        break;
      case 'join_error':
        this.callbacks.onJoinError(msg);
        break;
      case 'ack':
        this.callbacks.onAck(msg);
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
  }
}

export type { ClientViewState };
