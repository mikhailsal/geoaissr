import type { EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import type { BotTokenUsage } from '../../shared/bot-results.ts';
import { haversineDistanceKm } from '../../shared/score.ts';
import type { SettledBy } from './broker.ts';
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
  model: string;
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
  final: { summary: string | null; finding: string | null } | null;
  framesIssued: number;
  eyesLooks: number;
  corrections: SessionState['corrections'];
  guardRejections: string[];
  lateAnswers: number;
  invalidAnswers: number;
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
  }));
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
    final: s.final ? { summary: s.final.summary, finding: s.final.finding } : null,
    framesIssued: s.frames.length,
    eyesLooks: s.turnsUsed,
    corrections: s.corrections,
    guardRejections: s.guardRejections,
    lateAnswers: s.eyesAnswers.filter((a) => a.result === 'late').length,
    invalidAnswers: s.eyesAnswers.filter((a) => a.result === 'invalid').length,
    toolCalls: s.toolCalls,
    eyesDownAtSec: s.eyesDownAtMs === null ? null : sec(s.eyesDownAtMs),
    brain: ctx.brain,
    eyes: ctx.eyes,
    infraError: detectInfraError(s, ctx.brain),
  };
}
