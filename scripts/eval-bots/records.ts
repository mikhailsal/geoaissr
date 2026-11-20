import type { BotTokenUsage } from '../../shared/bot-results.ts';
import { haversineDistanceKm } from '../../shared/score.ts';
import type { BotGuessData, EngineEvent } from '../../server/engine/types.ts';

/** An engine event with the time (ms) it was dispatched, measured from the observe release. */
export interface TimedEvent {
  tMs: number;
  event: EngineEvent;
}

export interface StepText {
  turn: number;
  action: 'look' | 'move';
  hypothesis: string | null;
  /** The step's finding from the journal; null when none was recorded. */
  finding: string | null;
}

/**
 * `reason` of the `bot_finished` event the runner emits when no bot process could be started
 * (see `dispatchBotLaunchFailure` in server/bots/process.ts). It is infrastructure, not a result.
 */
export const LAUNCH_FAILURE_REASON = 'сбой запуска';

/** Tool-call audit counted from the runner's dispatch diagnostics; null when not observable. */
export interface ToolAudit {
  toolCalls: number;
  /** Calls rejected with an `isError` result (a correction the bot had to react to). */
  corrections: number;
}

export interface RoundRecord {
  spotId: string;
  /** Opaque id used for every runtime path and match id of this round. */
  executionId: string;
  repeat: number;
  harness: string;
  model: string;
  budgetSec: number;
  moveLimit: number;
  /** A `bot_finished` event arrived before the wait ended. */
  finished: boolean;
  aborted: boolean | null;
  finishReason: string | null;
  /** The wait hit budget + 15 s without `bot_finished`. */
  timedOut: boolean;
  /** A finalized guess arrived before the bot finished. */
  hasFinalGuess: boolean;
  timeToFinalSec: number | null;
  pin: { lat: number; lng: number } | null;
  pinSource: 'final' | 'checkpoint' | 'none';
  errorKm: number | null;
  firstCheckpoint: { lat: number; lng: number; tSec: number } | null;
  pinMovementKm: number | null;
  paidLooks: number;
  /** Paid steps carrying a finding; null when the event data has no finding field. */
  stepsWithFinding: number | null;
  tokenUsage: BotTokenUsage | null;
  steps: StepText[];
  /** Tool calls seen by the dispatch audit; null when the audit saw none. */
  toolCalls: number | null;
  /** Tool calls rejected with an isError correction; null when not observable. */
  corrections: number | null;
  /** Harness launch failure or setup failure: the round was not measured. */
  infraError: string | null;
  error: string | null;
}

export interface ScoredGuess {
  guess: BotGuessData | null;
  source: 'final' | 'checkpoint' | 'none';
  /** Time (ms) of the scored guess event, null when none. */
  tMs: number | null;
}

/** Select the first final guess, or the latest draft (checkpoint) before the bot finishes. */
export function pickScoredGuess(events: readonly TimedEvent[]): ScoredGuess {
  let draft: ScoredGuess = { guess: null, source: 'none', tMs: null };
  for (const { event, tMs } of events) {
    if (event.type === 'bot_finished') break;
    if (event.type !== 'bot_guess_recorded') continue;
    if (event.finalized ?? true) return { guess: event.guess, source: 'final', tMs };
    draft = { guess: event.guess, source: 'checkpoint', tMs };
  }
  return draft;
}

/** Select the first final guess, or the latest draft before the bot finishes. */
export function pickFinalGuess(events: readonly EngineEvent[]): BotGuessData | null {
  return pickScoredGuess(events.map((event) => ({ event, tMs: 0 }))).guess;
}

function firstGuessBeforeFinish(
  events: readonly TimedEvent[],
): { guess: BotGuessData; tMs: number } | null {
  for (const { event, tMs } of events) {
    if (event.type === 'bot_finished') return null;
    if (event.type === 'bot_guess_recorded') return { guess: event.guess, tMs };
  }
  return null;
}

/** Findings by step, from the journal's `bot_finding` events (the latest recorded one wins). */
function findingsByTurn(events: readonly TimedEvent[]): Map<number, string> | null {
  let seen = false;
  const byTurn = new Map<number, string>();
  for (const { event } of events) {
    if (event.type !== 'bot_finding') continue;
    seen = true;
    if (event.findingState === 'recorded' && event.finding) byTurn.set(event.turn, event.finding);
  }
  return seen ? byTurn : null;
}

/**
 * Paid steps with their reason and finding. `hasFindingField` is false for a bot contract
 * without findings (the baseline arm), so the metric is null there rather than zero.
 */
export function collectSteps(events: readonly TimedEvent[]): {
  steps: StepText[];
  hasFindingField: boolean;
} {
  const findings = findingsByTurn(events);
  const steps: StepText[] = [];
  for (const { event } of events) {
    if (event.type !== 'bot_thumb_added' || event.thumb.action === 'observe') continue;
    steps.push({
      turn: event.thumb.turn,
      action: event.thumb.action,
      hypothesis: event.thumb.hypothesis ?? null,
      finding: findings?.get(event.thumb.turn) ?? null,
    });
  }
  return { steps, hasFindingField: findings !== null };
}

function lastTokenUsage(events: readonly TimedEvent[]): BotTokenUsage | null {
  let usage: BotTokenUsage | null = null;
  for (const { event } of events) {
    if (event.type === 'bot_accounting' && event.accounting.tokenUsage) {
      usage = event.accounting.tokenUsage;
    }
  }
  return usage;
}

export interface RoundContext {
  spotId: string;
  executionId: string;
  repeat: number;
  harness: string;
  model: string;
  budgetSec: number;
  moveLimit: number;
  truth: { lat: number; lng: number };
  timedOut: boolean;
  audit?: ToolAudit | null;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Builds the per-round JSONL record from the event stream the bot runner already emits. */
export function buildRoundRecord(ctx: RoundContext, events: readonly TimedEvent[]): RoundRecord {
  const scored = pickScoredGuess(events);
  const first = firstGuessBeforeFinish(events);
  const finishedEvent = events.find((e) => e.event.type === 'bot_finished')?.event;
  const finished = finishedEvent?.type === 'bot_finished' ? finishedEvent : null;
  const { steps, hasFindingField } = collectSteps(events);
  const launchFailed = finished?.reason === LAUNCH_FAILURE_REASON;
  const pin = scored.guess ? { lat: scored.guess.lat, lng: scored.guess.lng } : null;
  return {
    spotId: ctx.spotId,
    executionId: ctx.executionId,
    repeat: ctx.repeat,
    harness: ctx.harness,
    model: ctx.model,
    budgetSec: ctx.budgetSec,
    moveLimit: ctx.moveLimit,
    finished: finished !== null,
    aborted: finished ? finished.aborted : null,
    finishReason: finished ? finished.reason : null,
    timedOut: ctx.timedOut,
    hasFinalGuess: scored.source === 'final',
    timeToFinalSec:
      scored.source === 'final' && scored.tMs !== null ? round1(scored.tMs / 1000) : null,
    pin,
    pinSource: scored.source,
    errorKm: pin ? round1(haversineDistanceKm(ctx.truth, pin)) : null,
    firstCheckpoint: first
      ? { lat: first.guess.lat, lng: first.guess.lng, tSec: round1(first.tMs / 1000) }
      : null,
    pinMovementKm: first && pin ? round1(haversineDistanceKm(first.guess, pin)) : null,
    paidLooks: steps.length,
    stepsWithFinding: hasFindingField ? steps.filter((s) => s.finding !== null).length : null,
    tokenUsage: lastTokenUsage(events),
    steps,
    toolCalls: ctx.audit ? ctx.audit.toolCalls : null,
    corrections: ctx.audit ? ctx.audit.corrections : null,
    infraError: launchFailed ? (finished.diagnosticsTail ?? finished.reason) : null,
    error: null,
  };
}

/** Record for a round that could not run at all (setup or runner failure). */
export function buildFailedRecord(
  ctx: Omit<RoundContext, 'truth' | 'timedOut'>,
  error: unknown,
): RoundRecord {
  return {
    ...ctx,
    finished: false,
    aborted: null,
    finishReason: null,
    timedOut: false,
    hasFinalGuess: false,
    timeToFinalSec: null,
    pin: null,
    pinSource: 'none',
    errorKm: null,
    firstCheckpoint: null,
    pinMovementKm: null,
    paidLooks: 0,
    stepsWithFinding: null,
    tokenUsage: null,
    steps: [],
    toolCalls: null,
    corrections: null,
    infraError: error instanceof Error ? error.message : String(error),
    error: error instanceof Error ? error.message : String(error),
  };
}
