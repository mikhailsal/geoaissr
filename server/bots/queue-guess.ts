import { parseGuessInput } from '../../shared/bot-tools.ts';
import {
  correctionText,
  gateStepCall,
  isBlindCall,
  recordBlindStep,
  recordStepFields,
  type MissingField,
} from './queue-journal.ts';
import {
  awaitRoundStart,
  recordQueueFailure,
  type QueueState,
  type ToolResponsePayload,
} from './queue-state.ts';

/**
 * `final_guess`: coordinates are always saved. A complete call (summary plus, after observe,
 * a finding) closes the session; an incomplete one is stored as a checkpoint and corrected once.
 */
export async function executeFinalGuess(
  st: QueueState,
  rawArgs: unknown,
  enqueuedAt: number,
): Promise<ToolResponsePayload> {
  const guess = parseGuessInput(rawArgs);
  if (!guess) return recordQueueFailure(st, 'Неверные координаты догадки.');
  if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };

  const missing: MissingField[] = [];
  const blind = isBlindCall(st, enqueuedAt);
  if (st.observed && !blind && !guess.finding) missing.push('finding');
  if (!guess.summary) missing.push('summary');
  const verdict = gateStepCall(st, 'final_guess', missing);
  const finalized = verdict === 'accept';

  if (finalized) {
    if (blind) recordBlindStep(st);
    else recordStepFields(st, guess, false);
  }
  const { finding: _finding, shifts: _shifts, ...record } = guess;
  st.handlers.onGuess(record, finalized);
  st.checkpoints += 1;
  st.finalized = finalized;
  if (!finalized) return { text: correctionText('final_guess', missing), isError: true };
  return { text: 'Окончательная догадка принята.' };
}
