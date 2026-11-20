import type { CurrentGuess, Shift } from '../../shared/bot-journal.ts';
import type { NormalizedGuessInput } from '../../shared/bot-tools.ts';

export interface ToolResponsePayload {
  text: string;
  images?: Array<{ name: string; base64: string; mimeType: string }>;
  isError?: boolean;
}

/** A guess as the engine stores it: the finding and shifts travel through `onFinding`. */
export type GuessRecord = Omit<NormalizedGuessInput, 'finding' | 'shifts'>;

export interface FindingRecord {
  /** Index of the step the finding belongs to (0 = the observe step). */
  turn: number;
  finding?: string;
  /** `pending` carries only a checkpoint and leaves the finding state alone. */
  findingState: 'recorded' | 'missing';
  /** The accepted call carried no `current_guess`. */
  pointMissing?: true;
  shifts?: Shift[];
  currentGuess?: CurrentGuess;
}

export interface BotSessionHandlers {
  waitObserveRelease: (signal: AbortSignal) => Promise<void>;
  executeObserve: () => Promise<ToolResponsePayload>;
  /** `signal` aborts when the round ends: a late call must not emit thumbs. */
  executeLook: (
    args: {
      heading: number;
      pitch: number;
      fov: number;
      hypothesis?: string;
    },
    signal: AbortSignal,
  ) => Promise<ToolResponsePayload>;
  executeMove: (
    args: { heading: number; hypothesis?: string },
    signal: AbortSignal,
  ) => Promise<ToolResponsePayload>;
  /** `finalized=false` stores a checkpoint (`current_guess`), `true` the final answer. */
  onGuess: (guess: GuessRecord, finalized: boolean) => void;
  /** Attaches a finding to a journal step. Optional so lightweight test handlers can skip it. */
  onFinding?: (record: FindingRecord) => void;
  onTurnsChanged: (turnsUsed: number) => void;
  getRemainingTimeSec: () => number;
}

export interface QueueState {
  moveLimit: number;
  moveEnabled: boolean;
  handlers: BotSessionHandlers;
  signal: AbortSignal;
  turnsUsed: number;
  failedCalls: number;
  roundStartedPromise: Promise<void> | null;
  finalized: boolean;
  requireCompleteReasoning: boolean;
  checkpoints: number;
  /** True once observe returned frames; from then on every paid call owes a finding. */
  observed: boolean;
  /** The first observe response; a repeated observe returns it and writes nothing. */
  observeResponse: ToolResponsePayload | null;
  /** `performance.now()` when the pending step's frame was delivered to the bot. */
  frameDeliveredAt: number;
  /** Pending step that already used its one correction; its next call is accepted as is. */
  correctedStep: number | null;
  /** Pending step whose call was accepted: it gets no second correction. */
  closedStep: number | null;
  /** Keys of the last journal write and checkpoint, so a retry never writes twice. */
  lastWrittenKey: string | null;
  lastCheckpointKey: string | null;
  /** Called for every one-time correction, so the host can log the correction rate. */
  onCorrection?: (info: { tool: string; missing: readonly string[]; code: string }) => void;
}

export function recordQueueFailure(st: QueueState, baseMsg: string): ToolResponsePayload {
  st.failedCalls += 1;
  return { text: `${baseMsg}\nХод не списан.`, isError: true };
}

export async function awaitRoundStart(st: QueueState): Promise<boolean> {
  if (st.signal.aborted) return false;
  st.roundStartedPromise ??= st.handlers.waitObserveRelease(st.signal);
  try {
    await st.roundStartedPromise;
  } catch {
    return false;
  }
  return !st.signal.aborted;
}
