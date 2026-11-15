import type { AckResult, ClientViewState, QuotaSummaryView } from '../../shared/protocol.ts';
import type {
  BotSlotConfig,
  MatchRecord,
  RegionId,
  SettingsFile,
} from '../../shared/storage-schemas.ts';
import { reduce } from './reduce.ts';
import type { EngineEffect, EngineEvent, RoomState, RoundTarget } from './types.ts';
import { projectView } from './view.ts';

export interface ShellDeps {
  now?: () => number;
  onStateChange?: (state: RoomState, version: number) => void;
  onAsyncError?: (context: string, err: unknown) => void;
  saveSettings: (settings: SettingsFile) => Promise<void>;
  confirmQuotaReset: () => Promise<QuotaSummaryView>;
  recalculateQuotaSummary?: (state: RoomState) => QuotaSummaryView;
  prepareRound: (opts: {
    matchId: string;
    gen: number;
    roundNumber: number;
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
  }) => void;
  releaseBotObserve: (matchId: string, gen: number, roundNumber: number) => void;
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
  dispose: () => void;
}

interface TimerRegistry {
  panoTimeout: ReturnType<typeof setTimeout> | null;
  countdown: ReturnType<typeof setTimeout> | null;
  deadline: ReturnType<typeof setTimeout> | null;
  botBudgets: Map<string, ReturnType<typeof setTimeout>>;
}

interface EffectContext {
  deps: ShellDeps;
  timers: TimerRegistry;
  nowFn: () => number;
  isDisposed: () => boolean;
  dispatch: (event: EngineEvent) => AckResult | undefined;
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
    void ctx.deps.saveSettings(effect.settings).catch((err: unknown) => {
      ctx.deps.onAsyncError?.('save_settings', err);
    });
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
        if (!ctx.isDisposed()) ctx.dispatch({ type: 'match_write_result', ok: true });
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
    type: 'schedule_pano_timeout' | 'schedule_countdown' | 'schedule_deadline';
  }
>;

function runScheduleEffect(ctx: EffectContext, effect: ScheduleEffect): void {
  const { timers } = ctx;
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
  timers.deadline = scheduleDelay(ctx, effect.atMs, () => {
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
          bots: effect.bots,
          moveEnabled: effect.moveEnabled,
        });
      }
      return;
    }
    case 'release_bot_observe':
      ctx.deps.releaseBotObserve(effect.matchId, effect.gen, effect.roundNumber);
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

export function createRoomShell(initialState: RoomState, deps: ShellDeps): RoomShell {
  const nowFn = deps.now ?? (() => Date.now());
  let state = initialState;
  let version = 1;
  let disposed = false;

  const timers: TimerRegistry = {
    panoTimeout: null,
    countdown: null,
    deadline: null,
    botBudgets: new Map(),
  };

  const ctx: EffectContext = {
    deps,
    timers,
    nowFn,
    isDisposed: () => disposed,
    dispatch,
  };

  function dispatch(event: EngineEvent): AckResult | undefined {
    if (disposed) return undefined;
    if (event.type === 'start_match' && deps.recalculateQuotaSummary && state.phase === 'LOBBY') {
      // Gate the start on the live quota counters, not on the summary cached at the last lobby edit.
      state = { ...state, quotaSummary: deps.recalculateQuotaSummary(state) };
    }
    const prevState = state;
    const out = reduce(prevState, event, nowFn());
    let nextState = out.state;
    if (
      deps.recalculateQuotaSummary &&
      nextState.phase === 'LOBBY' &&
      event.type !== 'quota_updated' &&
      event.type !== 'confirm_quota_reset'
    ) {
      nextState = { ...nextState, quotaSummary: deps.recalculateQuotaSummary(nextState) };
    }
    const changed = nextState !== prevState;
    state = nextState;

    if (changed && prevState.gen !== nextState.gen) {
      clearAllTimers(timers);
    }
    for (const effect of out.effects) {
      runSyncEffect(ctx, effect, nextState);
    }
    if (changed) {
      version += 1;
      deps.onStateChange?.(state, version);
    }
    return out.ack;
  }

  return {
    getState: () => state,
    getVersion: () => version,
    getView: (viewerId) => projectView(state, viewerId),
    dispatch,
    dispose: () => {
      disposed = true;
      clearAllTimers(timers);
      deps.stopAllBots('room_disposed');
    },
  };
}
