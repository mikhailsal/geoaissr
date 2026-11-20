import type { CurrentGuess, Shift } from '../../shared/bot-journal.ts';
import { parseFindingInput, parseShiftsInput } from '../../shared/bot-journal.ts';
import { parseCurrentGuessInput } from '../../shared/bot-tools.ts';
import type { QueueState } from './queue-state.ts';

export type MissingField = 'finding' | 'current_guess' | 'summary';

export interface StepFields {
  finding?: string;
  shifts?: Shift[];
  currentGuess?: CurrentGuess;
}

/** Splits the journal fields off a look/move call so the rest can be validated strictly. */
export function splitStepFields(raw: unknown): { rest: unknown; fields: StepFields } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { rest: raw, fields: {} };
  const { finding, shifts, current_guess: currentGuess, ...rest } = raw as Record<string, unknown>;
  const parsedFinding = parseFindingInput(finding);
  const parsedShifts = parseShiftsInput(shifts);
  const parsedGuess = parseCurrentGuessInput(currentGuess);
  return {
    rest,
    fields: {
      ...(parsedFinding ? { finding: parsedFinding } : {}),
      ...(parsedShifts ? { shifts: parsedShifts } : {}),
      ...(parsedGuess ? { currentGuess: parsedGuess } : {}),
    },
  };
}

export const JOURNAL_FIELD_MISSING_CODE = 'GEO_BOT_JOURNAL_FIELD_MISSING';

const FIELD_HINT: Record<MissingField, string> = {
  finding: 'finding (что показал предыдущий кадр)',
  current_guess: 'current_guess (лучшая точка сейчас: lat, lng)',
  summary: 'summary (итог от первого лица)',
};

function consequence(missing: readonly MissingField[]): string {
  const notes: string[] = [];
  if (missing.includes('finding')) notes.push('шаг пометят «вывод не записан»');
  if (missing.includes('current_guess')) {
    notes.push('точка останется прежней, шаг покажет «новая точка не записана»');
  }
  if (missing.includes('summary')) notes.push('итог останется пустым');
  return notes.join(', ');
}

/**
 * The single template of every one-time correction: tool, missing fields, fix, side effects,
 * retry bound and a stable code.
 */
export function correctionText(tool: string, missing: readonly MissingField[]): string {
  const list = missing.map((f) => FIELD_HINT[f]).join(', ');
  const names = missing.join(', ');
  const effects =
    tool === 'final_guess'
      ? 'Догадка ещё не записана окончательной, координаты сохранены как промежуточная точка.'
      : 'Кадр не запрошен, ход не списан.';
  const retry = `Исправление одно на шаг: следующий вызов примут, ${consequence(missing)}.`;
  return `Вызов ${tool} отклонён: не хватает ${missing.length > 1 ? 'полей' : 'поля'} ${list}. Повторите тот же вызов и добавьте ${names}. ${effects} ${retry} [${JOURNAL_FIELD_MISSING_CODE}]`;
}

/**
 * The correction allowance belongs to the pending step (the one whose finding is due), not to
 * the call's arguments. A call with missing fields is bounced once; the next call for the same
 * pending step is accepted whatever it carries, even with a different camera argument. The
 * allowance resets when the pending step closes, which is when a call is accepted.
 * Without `requireCompleteReasoning` nothing is bounced.
 */
export function gateStepCall(
  st: QueueState,
  tool: string,
  missing: readonly MissingField[],
): 'accept' | 'bounce' {
  const pending = st.turnsUsed;
  const allowed =
    missing.length === 0 ||
    !st.requireCompleteReasoning ||
    st.correctedStep === pending ||
    st.closedStep === pending;
  if (allowed) {
    st.correctedStep = null;
    st.closedStep = pending;
    return 'accept';
  }
  st.correctedStep = pending;
  st.onCorrection?.({ tool, missing, code: JOURNAL_FIELD_MISSING_CODE });
  return 'bounce';
}

/**
 * Writes what an accepted call carried onto the pending step (the observe step for the first
 * call): finding and shifts, then the point (also stored as a checkpoint). A retry that carries
 * the same values writes nothing twice.
 */
export function recordStepFields(st: QueueState, fields: StepFields, withPoint: boolean): void {
  if (!st.observed || st.signal.aborted) return;
  const turn = st.turnsUsed;
  const record = {
    turn,
    findingState: fields.finding ? 'recorded' : 'missing',
    ...(fields.finding ? { finding: fields.finding } : {}),
    ...(fields.shifts ? { shifts: fields.shifts } : {}),
    ...(fields.currentGuess ? { currentGuess: fields.currentGuess } : {}),
    ...(withPoint && !fields.currentGuess ? { pointMissing: true as const } : {}),
  } as const;
  const key = JSON.stringify(record);
  if (key === st.lastWrittenKey) return;
  st.lastWrittenKey = key;
  st.handlers.onFinding?.(record);
}

export function recordCheckpoint(st: QueueState, guess: CurrentGuess | undefined): void {
  if (!guess || st.signal.aborted) return;
  const key = `${st.turnsUsed}:${guess.lat}:${guess.lng}`;
  if (key === st.lastCheckpointKey) return;
  st.lastCheckpointKey = key;
  st.handlers.onGuess({ lat: guess.lat, lng: guess.lng, explanation: '' }, false);
  st.checkpoints += 1;
}

/**
 * A call enqueued before the pending step's frame was delivered (parallel tool calls) could not
 * have seen that frame, so it owes no finding for it.
 */
export function isBlindCall(st: QueueState, enqueuedAt: number): boolean {
  return st.observed && enqueuedAt < st.frameDeliveredAt;
}

/** The pending step gets no finding from a blind call: it is marked `missing`. */
export function recordBlindStep(st: QueueState): void {
  recordStepFields(st, {}, false);
}

export function missingStepFields(
  st: QueueState,
  fields: StepFields,
  blind = false,
): MissingField[] {
  if (blind) return [];
  const missing: MissingField[] = [];
  if (st.observed && !fields.finding) missing.push('finding');
  if (!fields.currentGuess) missing.push('current_guess');
  return missing;
}
