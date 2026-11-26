import {
  resolvePlayStyle,
  styleFallbacks,
  type PlayStyleFallback,
} from '../../shared/play-style.ts';
import type { MapId } from '../../shared/maps.ts';
import type { AckResult, ClientViewState, QuotaSummaryView } from '../../shared/protocol.ts';
import { LATE_PIN_GRACE_MS } from '../../shared/round-timing.ts';
import type {
  BotSlotConfig,
  MatchRecord,
  RegionId,
  SettingsFile,
} from '../../shared/storage-schemas.ts';
import { createSettingsWrites } from './settings-writes.ts';
import { createWinsClock } from './wins.ts';
import { reduce } from './reduce.ts';
import type { EngineEffect, EngineEvent, RoomState, RoundTarget } from './types.ts';
import { projectView } from './view.ts';

export interface ShellDeps {
  now?: () => number;
  matchRecords?: MatchRecord[];
  onStateChange?: (state: RoomState, version: number) => void;
  onAsyncError?: (context: string, err: unknown) => void;
  saveSettings: (settings: SettingsFile, strict?: boolean) => undefined;
  saveSettingsForReset?: (settings: SettingsFile) => Promise<void>;
  confirmQuotaReset: () => Promise<QuotaSummaryView>;
  recalculateQuotaSummary?: (state: RoomState) => QuotaSummaryView;
  prepareRound: (opts: {
    matchId: string;
    gen: number;
    roundNumber: number;
    map: MapId;
    region: RegionId;
    excludeCountryIds: string[];
    withBots: boolean;
  }) => Promise<RoundTarget>;
  startBotProcesses: (opts: {
    matchId: string;
    gen: number;
    roundNumber: number;
    target: RoundTarget;
    bots: BotSlotConfig[];
    moveEnabled: boolean;
    /** Slots set to Detective that play Intuit this round, with the reason; for the log. */
    styleFallbacks?: Record<string, PlayStyleFallback>;
  }) => void;
  releaseBotObserve: (matchId: string, gen: number, roundNumber: number) => void;
  /** Optional: tells running bots that the round now ends at `atMs` (epoch ms). */
  setBotRoundDeadline?: (matchId: string, gen: number, roundNumber: number, atMs: number) => void;
  stopBotProcess: (matchId: string, gen: number, botId: string, reason: string) => void;
  stopAllBots: (reason: string) => void;
  clearRoundImages: () => void;
  clearThumbs: () => void;
  appendMatchRecord: (record: MatchRecord) => Promise<void>;
  logRoundEnd: (info: {
    roundNumber: number;
    totalRounds: number;
    target: RoundTarget;
    answeredNames: string[];
    abortedBots: Array<{ name: string; reason: string }>;
  }) => void;
}

export interface RoomShell {
  getState: () => RoomState;
  getVersion: () => number;
  getView: (viewerId: string) => ClientViewState;
  dispatch: (event: EngineEvent) => AckResult | undefined;
  saveBotAppearance: (event: Extract<EngineEvent, { type: 'update_bot' }>) => Promise<AckResult>;
  dispose: () => void;
}

interface TimerRegistry {
  panoTimeout: ReturnType<typeof setTimeout> | null;
  countdown: ReturnType<typeof setTimeout> | null;
  deadline: ReturnType<typeof setTimeout> | null;
  botBudgets: Map<string, ReturnType<typeof setTimeout>>;
  guestSeatExpiries: Map<string, ReturnType<typeof setTimeout>>;
}

interface EffectContext {
  deps: ShellDeps;
  timers: TimerRegistry;
  nowFn: () => number;
  isDisposed: () => boolean;
  dispatch: (event: EngineEvent) => AckResult | undefined;
  settingsWrites: ReturnType<typeof createSettingsWrites>;
}

function createTimerRegistry(): TimerRegistry {
  return {
    panoTimeout: null,
    countdown: null,
    deadline: null,
    botBudgets: new Map(),
    guestSeatExpiries: new Map(),
  };
}

function clearTimer(t: ReturnType<typeof setTimeout> | null): null {
  if (t !== null) clearTimeout(t);
  return null;
}

function clearAllTimers(timers: TimerRegistry): void {
  timers.panoTimeout = clearTimer(timers.panoTimeout);
  timers.countdown = clearTimer(timers.countdown);
  timers.deadline = clearTimer(timers.deadline);
  for (const t of timers.botBudgets.values()) clearTimeout(t);
  timers.botBudgets.clear();
  for (const t of timers.guestSeatExpiries.values()) clearTimeout(t);
  timers.guestSeatExpiries.clear();
}

function scheduleDelay(
  ctx: EffectContext,
  atMs: number,
  fn: () => void,
): ReturnType<typeof setTimeout> {
  const delayMs = Math.max(0, atMs - ctx.nowFn());
  return setTimeout(() => {
    if (!ctx.isDisposed()) fn();
  }, delayMs);
}

function runAsyncEffect(ctx: EffectContext, effect: EngineEffect, state: RoomState): void {
  if (effect.type === 'save_settings') {
    ctx.settingsWrites.save();
    return;
  }
  if (effect.type === 'persist_bot_wins_reset') {
    ctx.settingsWrites.reset(effect.botId, effect.at);
    return;
  }
  if (effect.type === 'confirm_quota_reset') {
    void ctx.deps
      .confirmQuotaReset()
      .then((quotaSummary) => {
        if (!ctx.isDisposed()) ctx.dispatch({ type: 'quota_updated', quotaSummary });
      })
      .catch((err: unknown) => {
        ctx.deps.onAsyncError?.('confirm_quota_reset', err);
        if (!ctx.isDisposed() && ctx.deps.recalculateQuotaSummary) {
          ctx.dispatch({
            type: 'quota_updated',
            quotaSummary: ctx.deps.recalculateQuotaSummary(state),
            quotaWarning: 'Не удалось сохранить подтверждение квоты на диск.',
          });
        }
      });
    return;
  }
  if (effect.type === 'prepare_round') {
    void ctx.deps
      .prepareRound({
        matchId: effect.matchId,
        gen: effect.gen,
        roundNumber: effect.roundNumber,
        map: effect.map,
        region: effect.region,
        excludeCountryIds: effect.excludeCountryIds,
        withBots: effect.withBots,
      })
      .then((target) => {
        if (!ctx.isDisposed()) {
          ctx.dispatch({
            type: 'round_prepared',
            matchId: effect.matchId,
            gen: effect.gen,
            roundNumber: effect.roundNumber,
            target,
          });
        }
      })
      .catch((err: unknown) => {
        if (!ctx.isDisposed()) {
          const reason = err instanceof Error ? err.message : String(err);
          ctx.dispatch({
            type: 'round_prep_failed',
            matchId: effect.matchId,
            gen: effect.gen,
            roundNumber: effect.roundNumber,
            reason,
          });
        }
      });
    return;
  }
  if (effect.type === 'append_match_record') {
    void ctx.deps
      .appendMatchRecord(effect.record)
      .then(() => {
        if (!ctx.isDisposed())
          ctx.dispatch({ type: 'match_write_result', ok: true, record: effect.record });
      })
      .catch((err: unknown) => {
        if (!ctx.isDisposed()) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.dispatch({ type: 'match_write_result', ok: false, error: msg });
        }
      });
  }
}

type ScheduleEffect = Extract<
  EngineEffect,
  {
    type:
      | 'schedule_pano_timeout'
      | 'schedule_countdown'
      | 'schedule_deadline'
      | 'schedule_guest_seat_expiry';
  }
>;

function cancelGuestSeatExpiry(timers: TimerRegistry, playerId: string): void {
  const existing = timers.guestSeatExpiries.get(playerId);
  if (existing) clearTimeout(existing);
  timers.guestSeatExpiries.delete(playerId);
}

function runScheduleEffect(ctx: EffectContext, effect: ScheduleEffect): void {
  const { timers } = ctx;
  if (effect.type === 'schedule_guest_seat_expiry') {
    cancelGuestSeatExpiry(timers, effect.playerId);
    timers.guestSeatExpiries.set(
      effect.playerId,
      scheduleDelay(ctx, effect.atMs, () => {
        timers.guestSeatExpiries.delete(effect.playerId);
        ctx.dispatch({ type: 'expire_disconnected_guest', playerId: effect.playerId });
      }),
    );
    return;
  }
  if (effect.type === 'schedule_pano_timeout') {
    timers.panoTimeout = clearTimer(timers.panoTimeout);
    timers.panoTimeout = scheduleDelay(ctx, effect.atMs, () => {
      ctx.dispatch({ type: 'pano_load_timeout', matchId: effect.matchId, gen: effect.gen });
    });
    return;
  }
  if (effect.type === 'schedule_countdown') {
    timers.panoTimeout = clearTimer(timers.panoTimeout);
    timers.countdown = clearTimer(timers.countdown);
    timers.countdown = scheduleDelay(ctx, effect.atMs, () => {
      ctx.dispatch({ type: 'countdown_done', matchId: effect.matchId, gen: effect.gen });
    });
    return;
  }
  // schedule_deadline
  if (effect.kind === 'bot_budget' && effect.botId) {
    const prev = timers.botBudgets.get(effect.botId);
    if (prev) clearTimeout(prev);
    const bId = effect.botId;
    timers.botBudgets.set(
      bId,
      scheduleDelay(ctx, effect.atMs, () => {
        ctx.dispatch({
          type: 'deadline_tick',
          matchId: effect.matchId,
          gen: effect.gen,
          kind: 'bot_budget',
          botId: bId,
        });
      }),
    );
    return;
  }
  timers.deadline = clearTimer(timers.deadline);
  // Players see the round end at `atMs`; the round closes a moment later so that a pin sent in
  // its last second still counts. A wait for bots has no human pin left to arrive.
  const fireAt = effect.kind === 'round' ? effect.atMs + LATE_PIN_GRACE_MS : effect.atMs;
  timers.deadline = scheduleDelay(ctx, fireAt, () => {
    ctx.dispatch({
      type: 'deadline_tick',
      matchId: effect.matchId,
      gen: effect.gen,
      kind: effect.kind,
    });
  });
}

function runSyncEffect(ctx: EffectContext, effect: EngineEffect, currentState: RoomState): void {
  switch (effect.type) {
    case 'cancel_guest_seat_expiry':
      cancelGuestSeatExpiry(ctx.timers, effect.playerId);
      return;
    case 'schedule_guest_seat_expiry':
    case 'schedule_pano_timeout':
    case 'schedule_countdown':
    case 'schedule_deadline':
      runScheduleEffect(ctx, effect);
      return;
    case 'start_bot_processes': {
      const target = currentState.loadingOrActive?.target;
      if (target) {
        ctx.deps.startBotProcesses({
          matchId: effect.matchId,
          gen: effect.gen,
          roundNumber: effect.roundNumber,
          target,
          bots: effect.bots.map((bot) => ({
            ...bot,
            budgetSec: Math.min(bot.budgetSec, currentState.settings.roundDurationSec),
            // The runner launches the style the engine resolved, never the raw setting.
            playStyle: resolvePlayStyle(bot, currentState.settings.roundDurationSec).style,
          })),
          moveEnabled: effect.moveEnabled,
          styleFallbacks: styleFallbacks(effect.bots, currentState.settings.roundDurationSec),
        });
      }
      return;
    }
    case 'release_bot_observe':
      ctx.deps.releaseBotObserve(effect.matchId, effect.gen, effect.roundNumber);
      return;
    case 'set_bot_round_deadline':
      ctx.deps.setBotRoundDeadline?.(effect.matchId, effect.gen, effect.roundNumber, effect.atMs);
      return;
    case 'stop_bot_process': {
      const t = ctx.timers.botBudgets.get(effect.botId);
      if (t) {
        clearTimeout(t);
        ctx.timers.botBudgets.delete(effect.botId);
      }
      ctx.deps.stopBotProcess(effect.matchId, effect.gen, effect.botId, effect.reason);
      return;
    }
    case 'stop_all_bots':
      ctx.timers.deadline = clearTimer(ctx.timers.deadline);
      for (const t of ctx.timers.botBudgets.values()) clearTimeout(t);
      ctx.timers.botBudgets.clear();
      ctx.deps.stopAllBots(effect.reason);
      return;
    case 'clear_round_images':
      ctx.deps.clearRoundImages();
      return;
    case 'clear_thumbs':
      ctx.deps.clearThumbs();
      return;
    case 'log_round_end':
      ctx.deps.logRoundEnd({
        roundNumber: effect.roundNumber,
        totalRounds: effect.totalRounds,
        target: effect.target,
        answeredNames: effect.answeredNames,
        abortedBots: effect.abortedBots,
      });
      return;
    default:
      runAsyncEffect(ctx, effect, currentState);
  }
}

function updateLobbyQuota(state: RoomState, event: EngineEvent, deps: ShellDeps): RoomState {
  if (
    deps.recalculateQuotaSummary &&
    state.phase === 'LOBBY' &&
    event.type !== 'quota_updated' &&
    event.type !== 'confirm_quota_reset'
  ) {
    return { ...state, quotaSummary: deps.recalculateQuotaSummary(state) };
  }
  return state;
}

function settingsQueue(
  deps: ShellDeps,
  getState: () => RoomState,
  dispatch: (event: EngineEvent) => AckResult | undefined,
  isDisposed: () => boolean,
) {
  return createSettingsWrites({
    getState,
    save: deps.saveSettings,
    saveReset:
      deps.saveSettingsForReset ??
      ((settings) => {
        deps.saveSettings(settings, true);
      }),
    dispatch,
    onError: deps.onAsyncError,
    isDisposed,
  });
}

function applyShellEvent(
  state: RoomState,
  event: EngineEvent,
  deps: ShellDeps,
  now: number,
  records: MatchRecord[],
) {
  if (event.type === 'start_match' && deps.recalculateQuotaSummary && state.phase === 'LOBBY') {
    state = { ...state, quotaSummary: deps.recalculateQuotaSummary(state) };
  }
  const prevState = state;
  const out = reduce(state, event, now);
  const nextState = updateLobbyQuota(out.state, event, deps);
  if (event.type === 'match_write_result' && event.ok && event.record) records.push(event.record);
  return {
    prevState,
    nextState,
    out,
    refreshWins:
      (event.type === 'bot_wins_reset_result' && event.ok) ||
      (event.type === 'match_write_result' && event.ok && !!event.record),
  };
}

export function createRoomShell(
  initialState: RoomState,
  { matchRecords, ...deps }: ShellDeps,
): RoomShell {
  const nowFn = deps.now ?? (() => Date.now());
  let state = initialState;
  let version = 1;
  let disposed = false;
  const records = [...(matchRecords ?? [])];
  const winsClock = createWinsClock(
    records,
    nowFn,
    () => Object.fromEntries(state.settings.bots.map((b) => [b.id, b.winResetAt])),
    (wins6h, broadcast) => {
      state = { ...state, wins6h };
      if (broadcast) {
        version += 1;
        deps.onStateChange?.(state, version);
      }
    },
  );
  winsClock.refresh();
  const timers = createTimerRegistry();

  const getState = () => state;
  const isDisposed = () => disposed;
  const settingsWrites = settingsQueue(deps, getState, dispatch, isDisposed);
  const ctx: EffectContext = {
    settingsWrites,
    deps,
    timers,
    nowFn,
    isDisposed,
    dispatch,
  };

  function dispatch(event: EngineEvent, durable = false): AckResult | undefined {
    if (disposed) return undefined;
    const { prevState, nextState, out, refreshWins } = applyShellEvent(
      state,
      event,
      deps,
      nowFn(),
      records,
    );
    // Persist and publish in the same JS turn, after all older settings writes finish.
    if (durable && out.ack === 'ok') deps.saveSettings(nextState.settings, true);
    const changed = nextState !== prevState;
    state = nextState;
    if (refreshWins) winsClock.refresh();

    if (changed && prevState.gen !== nextState.gen) {
      clearAllTimers(timers);
    }
    for (const effect of out.effects) {
      if (!durable || effect.type !== 'save_settings') runSyncEffect(ctx, effect, nextState);
    }
    if (changed) {
      version += 1;
      deps.onStateChange?.(state, version);
    }
    return out.ack;
  }

  return {
    getState,
    getVersion: () => version,
    getView: (viewerId) => projectView(state, viewerId),
    dispatch,
    saveBotAppearance: (event) =>
      settingsWrites.enqueue(() => dispatch(event, true) ?? 'invalid').catch(() => 'invalid'),
    dispose: () => {
      disposed = true;
      winsClock.dispose();
      clearAllTimers(timers);
      deps.stopAllBots('room_disposed');
    },
  };
}
