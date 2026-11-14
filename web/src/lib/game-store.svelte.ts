import type { DifficultyPreset } from '$shared/bot-tools';
import type { ParticipantColorId } from '$shared/colors';
import type {
  ClientViewState,
  LobbySummary,
  RoundResultEntryView,
  ServerMessage,
} from '$shared/protocol';
import type { HarnessId, RegionId } from '$shared/storage-schemas';
import { ServerClock } from './clock';
import { subscribeMapsAuthFailure } from './maps-loader';
import { GeoWsClient, type WsClientCallbacks } from './ws-client';
import { RU } from '../i18n/ru';

export type AuthScreenError =
  'no_token' | 'invalid_token' | 'replaced_tab' | 'room_full' | 'unreachable';

export interface VisionToast {
  passed: boolean;
  elapsedMs: number;
  message: string;
}

export class GameStore {
  authState = $state<'checking' | 'error' | 'ready'>('checking');
  authError = $state<AuthScreenError | null>(null);
  joined = $state(false);
  role = $state<'host' | 'guest' | null>(null);
  browserMapsKey = $state<string | null>(null);
  fakeMode = $state(false);
  lobbySummary = $state<LobbySummary | null>(null);
  view = $state<ClientViewState | null>(null);

  connectionState = $state<'connecting' | 'connected' | 'reconnecting' | 'offline_failed'>(
    'connecting',
  );
  reconnectAttempt = $state(0);
  backOnline = $state(false);
  offlinePinWarning = $state(false);
  mapsJsFatalError = $state<string | null>(null);

  joinPending = $state(false);
  joinError = $state<{ code: string; message: string } | null>(null);
  private lastJoinNick = '';
  startMatchPending = $state(false);
  submittingGuess = $state(false);
  localPin = $state<{ roundNumber: number; lat: number; lng: number } | null>(null);
  checkingVisionBotId = $state<string | null>(null);
  visionToastByBot = $state<Record<string, VisionToast | undefined>>({});
  activeBotCard = $state<{ roundNumber: number; entry: RoundResultEntryView } | null>(null);
  clockTick = $state(0);

  private readonly clock = new ServerClock();
  private readonly wsClient: GeoWsClient;
  private backOnlineTimer: number | null = null;
  private clockTimer: number | null = null;
  private unsubMapsAuth: (() => void) | null = null;
  private startMatchSeq: number | null = null;
  private submitGuessSeq: number | null = null;
  private pinDirty = false;
  /** After a reconnect, re-send a pin the server may never have received. */
  private resendPinOnNextState = false;
  private unsentPanoLoaded: { roundNumber: number; countedLoad: boolean } | null = null;

  constructor() {
    this.wsClient = new GeoWsClient(this.buildWsCallbacks());
  }

  private handleHelloOk(msg: Extract<ServerMessage, { type: 'hello_ok' }>): void {
    this.clearTransientPending();
    this.clock.seed(msg.serverNow, Date.now());
    this.role = msg.role;
    this.browserMapsKey = msg.browserMapsKey;
    this.fakeMode = msg.fakeMode;
    this.lobbySummary = msg.lobbySummary;
    this.joined = Boolean(msg.restoredPlayerId);
    this.resendPinOnNextState = true;
    this.authError = null;
    this.authState = 'ready';
  }

  private handleAck(seq: number): void {
    if (seq === this.submitGuessSeq) {
      this.submittingGuess = false;
      this.submitGuessSeq = null;
    }
    if (seq === this.startMatchSeq) {
      this.startMatchPending = false;
      this.startMatchSeq = null;
    }
  }

  private buildWsCallbacks(): WsClientCallbacks {
    return {
      onNoToken: () => {
        this.clearTransientPending();
        this.authState = 'error';
        this.authError = 'no_token';
      },
      onHashToken: () => {
        this.resetForHashToken();
      },
      onSocketConnecting: () => {
        if (this.connectionState !== 'reconnecting') this.connectionState = 'connecting';
      },
      onSocketOpen: () => {
        this.connectionState = 'connected';
        this.reconnectAttempt = 0;
        this.offlinePinWarning = false;
      },
      onBackOnline: () => {
        this.triggerBackOnline();
      },
      onReconnecting: (attempt) => {
        this.connectionState = 'reconnecting';
        this.reconnectAttempt = attempt;
        this.clearTransientPending();
      },
      onReconnectTimeout: () => {
        this.connectionState = 'offline_failed';
        this.clearTransientPending();
        if (!this.joined && this.authState === 'checking') {
          this.authState = 'error';
          this.authError = 'unreachable';
        }
      },
      onPong: (serverNow, clientNow) => {
        this.clock.recordPong(serverNow, clientNow, Date.now());
      },
      onHelloOk: (msg) => {
        this.handleHelloOk(msg);
      },
      onHelloError: (msg) => {
        this.clearTransientPending();
        this.applyHelloError(msg.code);
      },
      onJoinOk: () => {
        this.joinPending = false;
        this.joinError = null;
        this.joined = true;
        this.authState = 'ready';
      },
      onJoinError: (msg) => {
        this.applyJoinError(msg);
      },
      onAck: (msg) => {
        this.handleAck(msg.seq);
      },
      onVisionCheckResult: (msg) => {
        if (this.checkingVisionBotId === msg.botId) this.checkingVisionBotId = null;
        this.visionToastByBot = {
          ...this.visionToastByBot,
          [msg.botId]: { passed: msg.passed, elapsedMs: msg.elapsedMs, message: msg.message },
        };
      },
      onState: (msg) => {
        this.applyStateUpdate(msg.serverNow, msg.view);
      },
      onPinSendFailed: () => {
        this.offlinePinWarning = true;
      },
    };
  }

  private clearTransientPending(): void {
    this.joinPending = false;
    this.checkingVisionBotId = null;
    this.startMatchPending = false;
    this.startMatchSeq = null;
    this.submittingGuess = false;
    this.submitGuessSeq = null;
  }

  private resetForHashToken(): void {
    this.authState = 'checking';
    this.authError = null;
    this.connectionState = 'connecting';
    this.reconnectAttempt = 0;
    this.joined = false;
    this.clearTransientPending();
    this.pinDirty = false;
    this.localPin = null;
    this.joinError = null;
    this.backOnline = false;
  }

  private applyJoinError(msg: Extract<ServerMessage, { type: 'join_error' }>): void {
    this.joinPending = false;
    this.lobbySummary = msg.lobbySummary;
    const msgByCode: Record<typeof msg.code, string> = {
      nick_taken: RU.join.nickTaken,
      color_taken: RU.join.colorTaken,
      room_full: RU.join.roomFull,
      bad_nick: RU.join.nameHint,
    };
    // A disconnected player's nick can be taken back only from their own browser; say so.
    const nick = this.lastJoinNick.toLowerCase();
    const ownSeatGone =
      msg.code === 'nick_taken' &&
      msg.lobbySummary.disconnected.some((n) => n.toLowerCase() === nick);
    this.joinError = {
      code: msg.code,
      message: ownSeatGone ? RU.join.nickTakenDisconnected : msgByCode[msg.code],
    };
  }

  private triggerBackOnline(): void {
    this.backOnline = true;
    if (this.backOnlineTimer !== null) window.clearTimeout(this.backOnlineTimer);
    this.backOnlineTimer = window.setTimeout(() => {
      this.backOnline = false;
    }, 2_000);
  }

  private applyHelloError(
    code: 'invalid_token' | 'room_full' | 'replaced_by_new_tab' | 'unauth_timeout',
  ): void {
    this.authState = 'error';
    if (code === 'invalid_token') this.authError = 'invalid_token';
    else if (code === 'replaced_by_new_tab') this.authError = 'replaced_tab';
    else if (code === 'room_full') this.authError = 'room_full';
    else this.authError = 'unreachable';
  }

  private applyStateUpdate(serverNow: number, view: ClientViewState): void {
    this.clock.seed(serverNow, Date.now());
    const prevRound = this.view?.roundNumber;
    const prevPhase = this.view?.phase;
    this.view = view;
    this.joined = view.viewerId !== '__unjoined__';
    if (view.phase !== 'LOBBY') {
      this.startMatchPending = false;
      this.startMatchSeq = null;
    }
    if (prevRound !== view.roundNumber || prevPhase !== view.phase) {
      if (view.phase !== 'ROUND_RESULTS') this.activeBotCard = null;
      if (view.phase !== 'ROUND_ACTIVE') {
        this.localPin = null;
        this.pinDirty = false;
        this.submittingGuess = false;
        this.submitGuessSeq = null;
        this.wsClient.clearPendingPin();
      } else {
        this.pinDirty = false;
        this.wsClient.clearPendingPin();
      }
    }
    if (view.active?.myPin) {
      const sameRound = this.localPin?.roundNumber === view.roundNumber;
      if (!sameRound || !this.pinDirty) {
        this.localPin = {
          roundNumber: view.roundNumber,
          lat: view.active.myPin.lat,
          lng: view.active.myPin.lng,
        };
      }
    }
    if (this.resendPinOnNextState) {
      this.resendPinOnNextState = false;
      this.resendDirtyPin(view);
      this.resendUnsentPanoLoaded(view);
    }
  }

  private resendUnsentPanoLoaded(view: ClientViewState): void {
    const pending = this.unsentPanoLoaded;
    this.unsentPanoLoaded = null;
    if (!pending || pending.roundNumber !== view.roundNumber) return;
    if (view.phase !== 'ROUND_LOADING' && view.phase !== 'ROUND_ACTIVE') return;
    this.sendPanoLoaded(pending.roundNumber, pending.countedLoad);
  }

  private resendDirtyPin(view: ClientViewState): void {
    const pin = this.localPin;
    if (view.phase !== 'ROUND_ACTIVE' || !view.active || view.active.myConfirmed) return;
    if (!this.pinDirty || pin?.roundNumber !== view.roundNumber) return;
    this.offlinePinWarning = !this.wsClient.sendPinThrottled(pin.roundNumber, pin.lat, pin.lng);
  }

  connect(): void {
    this.unsubMapsAuth?.();
    this.unsubMapsAuth = subscribeMapsAuthFailure((msg) => {
      this.mapsJsFatalError = msg;
      this.reportClientError('maps_js', 'gm_authFailure', msg);
    });
    if (this.clockTimer !== null) {
      window.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    this.clockTimer = window.setInterval(() => {
      this.clockTick += 1;
    }, 250);
    this.wsClient.start();
  }

  retryConnect(): void {
    this.authState = 'checking';
    this.authError = null;
    this.wsClient.retry();
  }

  destroy(): void {
    this.wsClient.close();
    this.unsubMapsAuth?.();
    if (this.backOnlineTimer !== null) window.clearTimeout(this.backOnlineTimer);
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
  }

  serverNow(): number {
    return this.clockTick >= 0 ? this.clock.now(Date.now()) : this.clock.now(Date.now());
  }

  remainingMs(endsAt: number): number {
    return Math.max(0, endsAt - this.serverNow());
  }

  join(nick: string, color: ParticipantColorId): void {
    this.lastJoinNick = nick.trim();
    this.joinError = null;
    this.joinPending = true;
    if (!this.wsClient.sendJoin(nick, color)) {
      this.joinPending = false;
      this.joinError = { code: 'offline', message: RU.join.serverUnreachable };
    }
  }

  updateLobby(patch: {
    rounds?: number;
    roundDurationSec?: number;
    moveEnabled?: boolean;
    region?: RegionId;
    aiWaitWindowSec?: number;
  }): void {
    this.wsClient.sendSequenced('update_lobby', { patch });
  }

  addBot(): void {
    this.wsClient.sendSequenced('add_bot');
  }

  removeBot(botId: string): void {
    this.wsClient.sendSequenced('remove_bot', { botId });
  }

  updateBot(
    botId: string,
    patch: {
      name?: string;
      color?: ParticipantColorId;
      enabled?: boolean;
      harness?: HarnessId;
      model?: string;
      effort?: 'low' | 'medium' | 'high';
      moveLimit?: number;
      imageSize?: 256 | 400 | 640;
      budgetSec?: number;
      personalityPreset?: 'neutral' | 'braggart' | 'humble' | 'scientist';
      personalityText?: string;
    },
  ): void {
    this.wsClient.sendSequenced('update_bot', { botId, patch });
  }

  applyBotPreset(botId: string, preset: Exclude<DifficultyPreset, 'custom'>): void {
    this.wsClient.sendSequenced('apply_bot_preset', { botId, preset });
  }

  checkBotVision(botId: string): void {
    this.checkingVisionBotId = botId;
    this.visionToastByBot = { ...this.visionToastByBot, [botId]: undefined };
    if (!this.wsClient.sendSequenced('check_bot_vision', { botId })) {
      this.checkingVisionBotId = null;
    }
  }

  confirmQuotaReset(): void {
    this.wsClient.sendSequenced('confirm_quota_reset');
  }

  startMatch(): void {
    this.startMatchPending = true;
    const res = this.wsClient.sendSequencedWithSeq('start_match');
    this.startMatchSeq = res.seq;
    if (!res.sent) {
      this.startMatchPending = false;
      this.startMatchSeq = null;
    }
  }

  retryRound(gen: number): void {
    this.wsClient.sendSequenced('retry_round', { gen });
  }

  endMatch(): void {
    this.wsClient.sendSequenced('end_match');
  }

  nextRound(roundNumber: number): void {
    this.wsClient.sendSequenced('next_round', { roundNumber });
  }

  playAgain(): void {
    this.wsClient.sendSequenced('play_again');
  }

  sendPanoLoaded(roundNumber: number, countedLoad: boolean): void {
    const sent = this.wsClient.sendSequenced('pano_loaded', { roundNumber, countedLoad });
    // PanoView reports once per round; keep an unsent report for the next connection.
    this.unsentPanoLoaded = sent ? null : { roundNumber, countedLoad };
  }

  sendMapLoaded(kind: 'guess' | 'results'): void {
    this.wsClient.sendMapLoadedOnce(kind);
  }

  reportClientError(source: 'maps_js' | 'pano' | 'map', code: string, message: string): void {
    if (source === 'maps_js' && code !== 'OK') {
      this.mapsJsFatalError ??= RU.round.mapsBlocked;
    }
    this.wsClient.sendSequenced('client_error', {
      source,
      code: code.slice(0, 120),
      message: message.slice(0, 400),
    });
  }

  setPin(roundNumber: number, lat: number, lng: number): void {
    this.localPin = { roundNumber, lat, lng };
    this.pinDirty = true;
    const sent = this.wsClient.sendPinThrottled(roundNumber, lat, lng);
    this.offlinePinWarning = !sent;
  }

  submitGuess(roundNumber: number, lat: number, lng: number): void {
    this.localPin = { roundNumber, lat, lng };
    this.pinDirty = true;
    this.submittingGuess = true;
    this.wsClient.clearPendingPin();
    const res = this.wsClient.sendSequencedWithSeq('submit_guess', { roundNumber, lat, lng });
    this.submitGuessSeq = res.seq;
    if (!res.sent) {
      this.submittingGuess = false;
      this.submitGuessSeq = null;
      this.offlinePinWarning = true;
    }
  }

  openBotCard(roundNumber: number, entry: RoundResultEntryView): void {
    this.activeBotCard = { roundNumber, entry };
  }

  closeBotCard(): void {
    if (!this.activeBotCard) return;
    this.activeBotCard = null;
  }
}
