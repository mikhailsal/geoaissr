import type { JournalReportLine, JournalStepPatch } from '../../../shared/bot-journal.ts';
import type { BotTurnThumbView } from '../../../shared/bot-results.ts';
import type { BotImageSize } from '../../../shared/bot-tools.ts';
import type { GuessConfidence } from '../../../shared/detective-tools.ts';
import type { RoundTarget } from '../../engine/types.ts';
import type { BotImageService } from '../../images/bot-image-service.ts';
import type { MoveTracker } from '../move.ts';
import type { FindingRecord, GuessRecord, ToolResponsePayload } from '../queue-state.ts';
import { createBroker, type Broker } from './broker.ts';
import { createPlaceGuard, type PlaceGuard } from './guard.ts';

/** Shared state of one Detective round: the handlers of both roles read and write it. */

export type ToolReply = ToolResponsePayload;

export interface FrameRecord {
  /** The number the eyes know the frame by; report lines and answers cite it. */
  n: number;
  action: 'observe' | 'look' | 'move';
  heading: number;
  /** Straight-line metres from the start; 0 for a frame taken at the start. */
  fromStartM: number;
  /** Compass word of the direction from the start to the frame's place («С», «ЮВ»). */
  fromStartDir: string | null;
}

/** A final guess carries the two extra fields of the Detective's `final_guess`. */
export type DetectiveGuess = GuessRecord & { confidence?: GuessConfidence; clue?: string };

/**
 * Where the session reports what happened. The launcher turns these calls into engine events;
 * tests record them.
 */
export interface DetectiveSink {
  /** A frame the eyes received, for the journal step `turn`. */
  frame: (thumb: BotTurnThumbView) => void;
  turns: (turnsUsed: number) => void;
  step: (turn: number, patch: JournalStepPatch) => void;
  finding: (record: FindingRecord) => void;
  guess: (guess: DetectiveGuess, finalized: boolean) => void;
  /** A one-time correction, so the host can log the correction rate. */
  correction?: (info: { role: 'brain' | 'eyes'; tool: string; reason: string }) => void;
}

export interface SessionOptions {
  imageService: BotImageService;
  tracker: MoveTracker;
  target: RoundTarget;
  imageSize: BotImageSize;
  /** Paid camera actions (look and move together) the eyes may spend in the round. */
  moveLimit: number;
  moveEnabled: boolean;
  /** Milliseconds left for this bot: the earlier of its budget end and the round end. */
  getRemainingMs: () => number;
  /** Resolves when the round starts (the observe gate) or the signal aborts. */
  waitStart: (signal: AbortSignal) => Promise<void>;
  sink: DetectiveSink;
  askTimeoutMs?: number;
  /** How long one `briefing` call waits for the report. */
  briefingWaitMs?: number;
  minRemainingMs?: number;
  nextRequestWaitMs?: number;
  now?: () => number;
}

export interface SessionState {
  opts: SessionOptions;
  broker: Broker;
  guard: PlaceGuard;
  /** Aborts when the round ends for this bot: waits and road walks stop. */
  abort: AbortController;
  frames: FrameRecord[];
  turnsUsed: number;
  /** Successful moves so far, and how many there were when each request reached the eyes. */
  movesDone: number;
  movesAtDelivery: Map<string, number>;
  /** Accepted asks so far; the journal step of ask number k has index k. */
  asks: number;
  controlAsked: boolean;
  /** The report as the brain reads it, once the eyes filed it. */
  report: JournalReportLine[] | null;
  reportWaiters: Array<() => void>;
  /** The brain has received the report. */
  briefed: boolean;
  correctionsUsed: Set<string>;
  /** Any point was recorded: a checkpoint or the final guess. */
  submittedGuess: boolean;
  final: boolean;
  eyesDown: boolean;
  ended: boolean;
}

export const ASK_TIMEOUT_MS = 30_000;
/** An ask with a drive waits longer: the road walk alone may take several seconds. */
export const DRIVE_ASK_TIMEOUT_MS = 45_000;
export const MIN_REMAINING_MS = 10_000;
export const NEXT_REQUEST_WAIT_MS = 20_000;
/** One `briefing` call waits this long for the report; the brain may call it again. */
export const BRIEFING_WAIT_MS = 40_000;
/** With less than this left, a control ask no longer fits before the final guess. */
export const CONTROL_MIN_LEFT_MS = 30_000;

export function createSessionState(opts: SessionOptions): SessionState {
  return {
    opts,
    broker: createBroker(opts.now ? { now: opts.now } : {}),
    guard: createPlaceGuard(),
    abort: new AbortController(),
    frames: [],
    turnsUsed: 0,
    movesDone: 0,
    movesAtDelivery: new Map(),
    asks: 0,
    controlAsked: false,
    report: null,
    reportWaiters: [],
    briefed: false,
    correctionsUsed: new Set(),
    submittedGuess: false,
    final: false,
    eyesDown: false,
    ended: false,
  };
}

export function remainingMs(s: SessionState): number {
  return s.opts.getRemainingMs();
}

export function secondsLeft(s: SessionState): number {
  return Math.max(0, Math.round(remainingMs(s) / 1000));
}

export function roundOver(s: SessionState): boolean {
  return s.ended || s.final || remainingMs(s) <= 0;
}

export function turnsLeft(s: SessionState): number {
  return Math.max(0, s.opts.moveLimit - s.turnsUsed);
}

export function errorReply(text: string): ToolReply {
  return { text, isError: true };
}

/** Wakes a brain that waits for the report: it was filed, the eyes left or the round ended. */
export function wakeReportWaiters(s: SessionState): void {
  for (const wake of s.reportWaiters.splice(0)) wake();
}

/** «кадр 7» or «кадр 7, 640 м к СВ от старта» for a frame taken away from the start. */
export function frameNote(s: SessionState, n: number): string {
  const frame = s.frames.find((f) => f.n === n);
  if (!frame || frame.fromStartM <= 0) return `кадр ${n}`;
  const where = frame.fromStartDir ? ` к ${frame.fromStartDir}` : '';
  return `кадр ${n}, ${Math.round(frame.fromStartM)} м${where} от старта`;
}
