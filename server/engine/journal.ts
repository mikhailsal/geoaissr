import type { BotJournal, JournalStep, JournalStepPatch } from '../../shared/bot-journal.ts';
import type { BotTurnThumbView } from '../../shared/protocol.ts';
import { haversineDistanceKm } from '../../shared/score.ts';
import type { BotRoundState, EngineEvent } from './types.ts';

type FindingEvent = Extract<EngineEvent, { type: 'bot_finding' }>;

/** A thumb opens its step on the first frame and adds frames to it afterwards; steps stay in index order. */
export function addThumbToJournal(
  journal: readonly JournalStep[],
  thumb: BotTurnThumbView,
  atMs: number,
): JournalStep[] {
  const frame = {
    label: thumb.label,
    thumbUrl: thumb.thumbUrl,
    ...(thumb.fullUrl ? { fullUrl: thumb.fullUrl } : {}),
    // Detective frames carry their number and action: one step holds looks and moves together.
    ...(thumb.n !== undefined ? { n: thumb.n, action: thumb.action } : {}),
    ...(thumb.params ? { params: thumb.params } : {}),
  };
  const existing = journal.find((s) => s.index === thumb.turn);
  if (existing) {
    return journal.map((s) => (s === existing ? { ...s, frames: [...s.frames, frame] } : s));
  }
  const step: JournalStep = {
    index: thumb.turn,
    kind: thumb.action,
    ...(thumb.hypothesis ? { reason: thumb.hypothesis } : {}),
    frames: [frame],
    findingState: 'pending',
    atMs,
  };
  return [...journal, step].sort((a, b) => a.index - b.index);
}

/**
 * Detective: sets fields on the step `turn`. A step that does not exist yet is an exchange the
 * brain has just opened (step 0 is opened by the start frames).
 */
export function patchJournalStep(
  journal: readonly JournalStep[],
  turn: number,
  patch: JournalStepPatch,
  atMs: number,
): JournalStep[] {
  if (journal.some((s) => s.index === turn)) {
    return journal.map((s) => (s.index === turn ? { ...s, ...patch } : s));
  }
  const step: JournalStep = {
    index: turn,
    kind: turn === 0 ? 'observe' : 'ask',
    frames: [],
    findingState: 'pending',
    atMs,
    ...patch,
  };
  return [...journal, step].sort((a, b) => a.index - b.index);
}

/** A later point replaces the «новая точка не записана» marker of an earlier write. */
function applyFinding(
  s: JournalStep,
  event: FindingEvent,
  prev: JournalStep['currentGuess'],
): JournalStep {
  const { pointMissing: _stale, ...withoutMarker } = s;
  const base = event.currentGuess ? withoutMarker : s;
  return {
    ...base,
    findingState: event.findingState,
    ...(event.pointMissing ? { pointMissing: true } : {}),
    ...(event.finding ? { finding: event.finding } : {}),
    ...(event.shifts ? { shifts: event.shifts } : {}),
    ...(event.currentGuess
      ? {
          currentGuess: event.currentGuess,
          ...(prev ? { movedKm: haversineDistanceKm(prev, event.currentGuess) } : {}),
        }
      : {}),
  };
}

/** Attaches a finding to its step; an event for an unknown step changes nothing. */
export function addFindingToJournal(
  journal: readonly JournalStep[],
  event: FindingEvent,
): JournalStep[] {
  const prev = journal
    .filter((s) => s.index < event.turn && s.currentGuess)
    .sort((a, b) => b.index - a.index)[0]?.currentGuess;
  return journal.map((s) => (s.index === event.turn ? applyFinding(s, event, prev) : s));
}

/**
 * The journal as the result card gets it. Steps still waiting for a finding when the
 * round is scored are marked `round-ended`.
 */
export function finalizeJournal(bot: BotRoundState): BotJournal | undefined {
  const steps = (bot.journal ?? []).map((s) =>
    s.findingState === 'pending' ? { ...s, findingState: 'round-ended' as const } : s,
  );
  const finalized = bot.guess !== null && bot.guessFinalized !== false;
  const summary = bot.guess?.summary;
  const lastFinding = finalized ? steps.at(-1)?.finding : undefined;
  if (steps.length === 0 && !summary) return undefined;
  return {
    steps,
    ...(summary ? { summary } : {}),
    ...(lastFinding ? { finalFinding: lastFinding } : {}),
    ...(bot.playStyle === 'detective' ? { style: bot.playStyle } : {}),
    ...(finalized && bot.guess?.confidence ? { confidence: bot.guess.confidence } : {}),
    ...(finalized && bot.guess?.clue ? { clue: bot.guess.clue } : {}),
  };
}
