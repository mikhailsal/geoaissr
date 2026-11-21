import type { EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import type { BotTokenUsage } from '../../shared/bot-results.ts';
import { haversineDistanceKm } from '../../shared/score.ts';
import type { SettledBy } from './broker.ts';
import type { Confidence } from './ceiling-prompts.ts';
import type { Protocol } from './protocol.ts';
import { reportLines, type ReportLine, type SectionId } from './report.ts';
import { scoreItem, type ScoredItem } from './scoring.ts';
import type { SessionState } from './state.ts';

/** One measured Detective round, as appended to rounds.jsonl (never committed). */

export type Arm = 'detective' | 'labels';

export interface AskRow {
  index: number;
  tSec: number;
  hypothesis: string;
  finding: string | null;
  findingState: 'not_due' | 'recorded' | 'missing';
  currentGuess: { lat: number; lng: number } | null;
  settledBy: SettledBy | null;
  cycleSec: number | null;
  items: ScoredItem[];
  /** Report protocol: the brain marked this ask as its control check. */
  control?: boolean;
}

/** What the report protocol adds to a round record (spike 3, Part C). */
export interface ReportRoundFields {
  /** The eyes' scene report as they wrote it; null when none was filed. */
  report: {
    tSec: number;
    lines: Array<ReportLine & { section: SectionId }>;
    maskedWords: string[];
    unknownFrames: number;
  } | null;
  /** When the brain first received the report. */
  briefingAtSec: number | null;
  /** Requests refused for their question form («?» or «ли»). */
  formRejections: number;
  /** Zooms the eyes made before they filed the report; null without a report. */
  looksBeforeReport: number | null;
  /** Zooms the server refused because the report was not filed yet. */
  earlyLookRefusals: number;
  /** Place words masked in the eyes' answers before the brain read them. */
  maskedInAnswers: string[];
}

export interface RoleExit {
  code: number | null;
  usage: BotTokenUsage | null;
  stderrTail: string;
}

export interface DetectiveRoundRecord {
  spotId: string;
  executionId: string;
  repeat: number;
  arm: Arm;
  /** The brain's model; `eyesModel` is the eyes' model. */
  model: string;
  eyesModel: string;
  protocol: Protocol;
  requireZoom: boolean;
  budgetSec: number;
  moveLimit: number;
  hasFinalGuess: boolean;
  timeToFinalSec: number | null;
  pin: { lat: number; lng: number } | null;
  pinSource: 'final' | 'checkpoint' | 'none';
  errorKm: number | null;
  /** Asks settled by an answer (eyes or labels); timed-out and eyes-down asks do not count. */
  exchanges: number;
  /** Asks that reached the broker, whatever their outcome. */
  asksSent: number;
  asks: AskRow[];
  final: {
    summary: string | null;
    finding: string | null;
    /** Report protocol only. */
    confidence?: Confidence | null;
    clue?: string | null;
  } | null;
  /** Present only under the report protocol. */
  reportRound?: ReportRoundFields;
  framesIssued: number;
  eyesLooks: number;
  corrections: SessionState['corrections'];
  guardRejections: string[];
  optionRejections: number;
  lateAnswers: number;
  invalidAnswers: number;
  zoomRefusals: number;
  toolCalls: SessionState['toolCalls'];
  eyesDownAtSec: number | null;
  brain: RoleExit | null;
  eyes: RoleExit | null;
  infraError: string | null;
}

const sec = (ms: number): number => Math.round(ms / 100) / 10;

function pickPin(s: SessionState): Pick<DetectiveRoundRecord, 'pin' | 'pinSource'> {
  if (s.final) return { pin: { lat: s.final.lat, lng: s.final.lng }, pinSource: 'final' };
  const last = s.checkpoints.at(-1);
  return last
    ? { pin: { lat: last.lat, lng: last.lng }, pinSource: 'checkpoint' }
    : { pin: null, pinSource: 'none' };
}

function askRows(sample: EvalSampleItem, s: SessionState): AskRow[] {
  return s.asks.map((a) => ({
    index: a.index,
    tSec: sec(a.tMs),
    hypothesis: a.hypothesis,
    finding: a.finding,
    findingState: a.findingState,
    currentGuess: a.currentGuess,
    settledBy: a.outcome?.settledBy ?? null,
    cycleSec: a.outcome ? sec(a.outcome.cycleMs) : null,
    items: (a.outcome?.items ?? []).map((item) => scoreItem(sample, item)),
    ...(a.control ? { control: true } : {}),
  }));
}

function reportRoundFields(s: SessionState): ReportRoundFields {
  const filedAtMs = s.report?.tMs ?? null;
  return {
    report: s.report
      ? {
          tSec: sec(s.report.tMs),
          lines: reportLines(s.report.raw),
          maskedWords: s.report.maskedWords,
          unknownFrames: s.report.unknownFrames,
        }
      : null,
    briefingAtSec: s.briefingAtMs === null ? null : sec(s.briefingAtMs),
    formRejections: s.formRejections,
    looksBeforeReport:
      filedAtMs === null
        ? null
        : s.frames.filter((f) => f.action === 'look' && f.tMs <= filedAtMs).length,
    earlyLookRefusals: s.earlyLookRefusals,
    maskedInAnswers: s.maskedInAnswers,
  };
}

function finalRow(s: SessionState): DetectiveRoundRecord['final'] {
  if (!s.final) return null;
  const base = { summary: s.final.summary, finding: s.final.finding };
  if (s.opts.protocol !== 'report') return base;
  return { ...base, confidence: s.final.confidence ?? null, clue: s.final.clue ?? null };
}

/** An infra error is a round the model never played: a CLI that failed before any tool call. */
function detectInfraError(s: SessionState, brain: RoleExit | null): string | null {
  if (!brain) return null;
  if (s.toolCalls.brain === 0 && brain.code !== 0) {
    return `brain CLI exited with code ${brain.code ?? 'null'} before its first tool call`;
  }
  return null;
}

export function buildDetectiveRecord(ctx: {
  sample: EvalSampleItem;
  executionId: string;
  repeat: number;
  arm: Arm;
  model: string;
  eyesModel: string;
  budgetSec: number;
  moveLimit: number;
  state: SessionState;
  brain: RoleExit | null;
  eyes: RoleExit | null;
}): DetectiveRoundRecord {
  const s = ctx.state;
  const { pin, pinSource } = pickPin(s);
  const asks = askRows(ctx.sample, s);
  return {
    spotId: ctx.sample.id,
    executionId: ctx.executionId,
    repeat: ctx.repeat,
    arm: ctx.arm,
    model: ctx.model,
    eyesModel: ctx.eyesModel,
    protocol: s.opts.protocol,
    requireZoom: s.opts.requireZoom,
    budgetSec: ctx.budgetSec,
    moveLimit: ctx.moveLimit,
    hasFinalGuess: s.final !== null,
    timeToFinalSec: s.final ? sec(s.final.tMs) : null,
    pin,
    pinSource,
    errorKm:
      pin === null
        ? null
        : Math.round(haversineDistanceKm(pin, { lat: ctx.sample.lat, lng: ctx.sample.lng }) * 10) /
          10,
    exchanges: asks.filter((a) => a.settledBy === 'answer').length,
    asksSent: asks.filter((a) => a.settledBy !== null).length,
    asks,
    final: finalRow(s),
    ...(s.opts.protocol === 'report' ? { reportRound: reportRoundFields(s) } : {}),
    framesIssued: s.frames.length,
    eyesLooks: s.turnsUsed,
    corrections: s.corrections,
    guardRejections: s.guardRejections,
    optionRejections: s.optionRejections,
    lateAnswers: s.eyesAnswers.filter((a) => a.result === 'late').length,
    invalidAnswers: s.eyesAnswers.filter((a) => a.result === 'invalid').length,
    zoomRefusals: s.zoomRefusals,
    toolCalls: s.toolCalls,
    eyesDownAtSec: s.eyesDownAtMs === null ? null : sec(s.eyesDownAtMs),
    brain: ctx.brain,
    eyes: ctx.eyes,
    infraError: detectInfraError(s, ctx.brain),
  };
}
