import type { RoundTarget } from '../../server/engine/types.ts';
import type { BotImageService } from '../../server/images/bot-image-service.ts';
import type { BotImageSize } from '../../shared/bot-tools.ts';
import type { EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import { createBroker, type AskOutcome, type Broker, type Question } from './broker.ts';
import type { CatalogFeature } from './catalog.ts';
import type { Confidence } from './ceiling-prompts.ts';
import { createPlaceGuard, type PlaceGuard } from './guard.ts';
import type { Protocol } from './protocol.ts';
import type { SceneReport } from './report.ts';

/** Shared state of one Detective round: both roles' handlers read and write it. */

export type AnswerSource = 'eyes' | 'labels';

export interface ToolReply {
  text: string;
  images?: Array<{ name: string; base64: string; mimeType: string }>;
  isError?: boolean;
}

export interface FrameRecord {
  n: number;
  action: 'observe' | 'look';
  heading: number;
  pitch: number;
  fov: number;
  tMs: number;
}

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface AskRecord {
  index: number;
  tMs: number;
  hypothesis: string;
  questions: Question[];
  /** What the previous answers showed; null on the first ask or when not written. */
  finding: string | null;
  findingState: 'not_due' | 'recorded' | 'missing';
  currentGuess: LatLngPoint | null;
  outcome: AskOutcome | null;
  /** Report protocol: the brain marked this ask as its control check. */
  control?: boolean;
}

export interface FinalRecord extends LatLngPoint {
  tMs: number;
  summary: string | null;
  finding: string | null;
  /** Report protocol only. */
  confidence?: Confidence | null;
  clue?: string | null;
}

/** The scene report of the report protocol (spike 3). */
export interface ReportRecord {
  tMs: number;
  /** As the eyes wrote it. */
  raw: SceneReport;
  /** As the brain reads it: place words outside «…» are masked. */
  masked: SceneReport;
  maskedWords: string[];
  /** Lines that name a frame the eyes were never given. */
  unknownFrames: number;
}

export interface EyesAnswerLog {
  requestId: string;
  tMs: number;
  /** zoom: refused under requireZoom because it abstained without a look. */
  result: 'settled' | 'late' | 'unknown' | 'invalid' | 'zoom';
}

export interface SessionOptions {
  sample: EvalSampleItem;
  catalog: CatalogFeature[];
  imageService: BotImageService;
  target: RoundTarget;
  imageSize: BotImageSize;
  moveLimit: number;
  budgetSec: number;
  answerSource: AnswerSource;
  protocol: Protocol;
  /** The eyes must make a look during a request before they may abstain (spike 2). */
  requireZoom: boolean;
  askTimeoutMs?: number;
  /** Report protocol: how long one `briefing` call waits for the report. */
  briefingWaitMs?: number;
  minRemainingMs?: number;
  nextRequestWaitMs?: number;
  now?: () => number;
}

export interface SessionState {
  opts: SessionOptions;
  now: () => number;
  broker: Broker;
  guard: PlaceGuard;
  t0: number | null;
  frames: FrameRecord[];
  turnsUsed: number;
  asks: AskRecord[];
  checkpoints: Array<LatLngPoint & { tMs: number }>;
  final: FinalRecord | null;
  correctionsUsed: Set<string>;
  corrections: Array<{ role: 'brain' | 'eyes'; tool: string; reason: string }>;
  guardRejections: string[];
  /** Choice questions refused for repeated or built-in options. */
  optionRejections: number;
  eyesAnswers: EyesAnswerLog[];
  /** Paid looks already used when each request was first delivered to the eyes. */
  looksAtDelivery: Map<string, number>;
  /** When the outstanding ask times out (server clock); null when none is open. */
  askDeadlineAt: number | null;
  /** Answers refused because they abstained without a look (requireZoom). */
  zoomRefusals: number;
  /** Report protocol: the eyes' scene report, once filed. */
  report: ReportRecord | null;
  reportWaiters: Array<() => void>;
  /** Report protocol: when the brain first received the report. */
  briefingAtMs: number | null;
  /** Report protocol: requests refused for their question form («?» or «ли»). */
  formRejections: number;
  /** Zooms refused because the scene report was not filed yet (report protocol). */
  earlyLookRefusals: number;
  /** Report protocol: place words masked in the eyes' answers before the brain read them. */
  maskedInAnswers: string[];
  toolCalls: { brain: number; eyes: number; brainErrors: number; eyesErrors: number };
  eyesDownAtMs: number | null;
  /** Set when the round runner ends the round (final, brain exit, budget or abort). */
  ended: boolean;
  finalListeners: Array<() => void>;
}

export const ASK_TIMEOUT_MS = 30_000;
export const MIN_REMAINING_MS = 10_000;
export const NEXT_REQUEST_WAIT_MS = 20_000;
/** With less than this left before the ask times out, the eyes may abstain without a look. */
export const ZOOM_MIN_LEFT_MS = 12_000;

export function createSessionState(opts: SessionOptions): SessionState {
  return {
    opts,
    now: opts.now ?? Date.now,
    broker: createBroker({ now: opts.now }),
    guard: createPlaceGuard(),
    t0: null,
    frames: [],
    turnsUsed: 0,
    asks: [],
    checkpoints: [],
    final: null,
    correctionsUsed: new Set(),
    corrections: [],
    guardRejections: [],
    optionRejections: 0,
    eyesAnswers: [],
    looksAtDelivery: new Map(),
    askDeadlineAt: null,
    zoomRefusals: 0,
    report: null,
    reportWaiters: [],
    briefingAtMs: null,
    formRejections: 0,
    earlyLookRefusals: 0,
    maskedInAnswers: [],
    toolCalls: { brain: 0, eyes: 0, brainErrors: 0, eyesErrors: 0 },
    eyesDownAtMs: null,
    ended: false,
    finalListeners: [],
  };
}

/** Milliseconds since the round started (0 before the start). */
export function elapsedMs(s: SessionState): number {
  return s.t0 === null ? 0 : s.now() - s.t0;
}

export function remainingMs(s: SessionState): number {
  return s.opts.budgetSec * 1000 - elapsedMs(s);
}

export function roundOver(s: SessionState): boolean {
  return s.ended || s.final !== null || (s.t0 !== null && remainingMs(s) <= 0);
}

export function errorReply(text: string): ToolReply {
  return { text, isError: true };
}

/** Wakes a brain that waits for the report: it was filed, the eyes left or the round ended. */
export function wakeReportWaiters(s: SessionState): void {
  for (const wake of s.reportWaiters.splice(0)) wake();
}
