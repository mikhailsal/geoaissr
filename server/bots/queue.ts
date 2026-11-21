import {
  formatToolZodError,
  lookInputSchema,
  moveInputSchema,
  observeInputSchema,
} from '../../shared/bot-tools.ts';
import { executeFinalGuess } from './queue-guess.ts';
import {
  correctionText,
  gateStepCall,
  isBlindCall,
  missingStepFields,
  owedFields,
  recordBlindStep,
  recordCheckpoint,
  recordStepFields,
  splitStepFields,
  type StepFields,
} from './queue-journal.ts';
import {
  awaitRoundStart,
  recordQueueFailure,
  type BotSessionHandlers,
  type QueueState,
  type ToolResponsePayload,
} from './queue-state.ts';

export type {
  BotSessionHandlers,
  FindingRecord,
  GuessRecord,
  ToolResponsePayload,
} from './queue-state.ts';

export interface ToolDispatchAudit {
  tool: string;
  args: unknown;
  durationMs: number;
  checkpointSaved: boolean;
  result?: {
    text: string;
    isError: boolean;
    imageCount: number;
    images: Array<{ name: string; mimeType: string }>;
  };
  error?: string;
}

export interface BotToolQueue {
  dispatch: (toolName: string, rawArgs: unknown) => Promise<ToolResponsePayload>;
  getTurnsUsed: () => number;
  getFailedCalls: () => number;
  abort: (reason: string) => void;
}

const LOOK_ARGS = lookInputSchema
  .omit({ finding: true, shifts: true, current_guess: true })
  .extend({ hypothesis: lookInputSchema.shape.hypothesis.optional() });
const MOVE_ARGS = moveInputSchema
  .omit({ finding: true, shifts: true, current_guess: true })
  .extend({ hypothesis: moveInputSchema.shape.hypothesis.optional() });

function optionalHypothesis(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const data = { ...raw } as Record<string, unknown>;
  const parsed = lookInputSchema.shape.hypothesis.safeParse(data.hypothesis);
  if (parsed.success) data.hypothesis = parsed.data;
  else delete data.hypothesis;
  return data;
}

function limitReached(st: QueueState): ToolResponsePayload {
  return {
    text: `Лимит ходов (${st.moveLimit}) исчерпан. Отправьте догадку через final_guess.`,
    isError: true,
  };
}

/**
 * Journal gate shared by look and move. A call missing the finding (owed after observe) or
 * `current_guess` is bounced once per pending step and persists nothing. An accepted call
 * writes the finding, shifts and point onto the pending step before the camera action runs.
 * A blind call (enqueued before the pending frame was delivered) is accepted without a
 * correction and writes no finding. Returns a response when the call must not run.
 */
function reviewStep(
  st: QueueState,
  tool: 'look' | 'move',
  fields: StepFields,
  enqueuedAt: number,
): ToolResponsePayload | null {
  const blind = isBlindCall(st, enqueuedAt);
  const missing = owedFields(st, missingStepFields(st, fields, blind));
  const verdict = gateStepCall(st, tool, missing);
  if (verdict === 'bounce') return recordQueueFailure(st, correctionText(tool, missing));
  if (blind) recordBlindStep(st);
  else recordStepFields(st, fields, true);
  recordCheckpoint(st, fields.currentGuess);
  return null;
}

async function executePaidStep(
  st: QueueState,
  tool: 'look' | 'move',
  rawArgs: unknown,
  enqueuedAt: number,
): Promise<ToolResponsePayload> {
  const { rest, fields } = splitStepFields(rawArgs ?? {});
  const parsed = (tool === 'look' ? LOOK_ARGS : MOVE_ARGS).safeParse(optionalHypothesis(rest));
  if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
  if (st.turnsUsed >= st.moveLimit) return limitReached(st);
  if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
  const bounced = reviewStep(st, tool, fields, enqueuedAt);
  if (bounced) return bounced;

  let res: ToolResponsePayload;
  if (tool === 'look') {
    const { fov, zoom, ...look } = LOOK_ARGS.parse(optionalHypothesis(rest));
    const effectiveFov = Math.max(10, Math.min(120, fov ?? (zoom ? Math.round(90 / zoom) : 90)));
    res = await st.handlers.executeLook({ ...look, fov: effectiveFov }, st.signal);
  } else {
    res = await st.handlers.executeMove(MOVE_ARGS.parse(optionalHypothesis(rest)), st.signal);
  }
  if (st.signal.aborted) return { text: 'Раунд уже завершён.', isError: true };
  if (res.isError) return recordQueueFailure(st, res.text);
  st.frameDeliveredAt = performance.now();
  st.turnsUsed += 1;
  st.handlers.onTurnsChanged(st.turnsUsed);
  return res;
}

async function executeObserve(st: QueueState, rawArgs: unknown): Promise<ToolResponsePayload> {
  const parsed = observeInputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
  if (st.observeResponse) return st.observeResponse;
  if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
  const res = await st.handlers.executeObserve();
  if (!res.isError && !st.signal.aborted) {
    st.observed = true;
    st.observeResponse = res;
    st.frameDeliveredAt = performance.now();
  }
  return res;
}

async function executeQueuedTool(
  st: QueueState,
  toolName: string,
  rawArgs: unknown,
  enqueuedAt: number,
): Promise<ToolResponsePayload> {
  if (st.signal.aborted) return { text: 'Раунд уже завершён.', isError: true };
  if (st.finalized) return { text: 'Окончательная догадка уже отправлена.', isError: true };
  if (toolName === 'observe') return executeObserve(st, rawArgs);
  if (toolName === 'final_guess') return executeFinalGuess(st, rawArgs, enqueuedAt);
  if (toolName === 'look') return executePaidStep(st, 'look', rawArgs, enqueuedAt);
  if (toolName === 'move') {
    if (!st.moveEnabled) return recordQueueFailure(st, 'Движение (move) отключено в этой партии.');
    return executePaidStep(st, 'move', rawArgs, enqueuedAt);
  }
  return recordQueueFailure(st, `Неизвестный инструмент: ${toolName}`);
}

function emitDispatchAudit(
  observer: ((audit: ToolDispatchAudit) => void) | undefined,
  audit: Omit<ToolDispatchAudit, 'result'>,
  result: ToolResponsePayload | undefined,
): void {
  try {
    observer?.({
      ...audit,
      ...(result
        ? {
            result: {
              text: result.text,
              isError: result.isError === true,
              imageCount: result.images?.length ?? 0,
              images: (result.images ?? []).map(({ name, mimeType }) => ({ name, mimeType })),
            },
          }
        : {}),
    });
  } catch {
    // Logging must never change the result of a tool call.
  }
}

function initialState(
  opts: Parameters<typeof createBotToolQueue>[0],
  signal: AbortSignal,
): QueueState {
  return {
    moveLimit: opts.moveLimit,
    moveEnabled: opts.moveEnabled,
    handlers: opts.handlers,
    signal,
    turnsUsed: 0,
    failedCalls: 0,
    roundStartedPromise: null,
    finalized: false,
    requireCompleteReasoning: opts.requireCompleteReasoning ?? false,
    checkpoints: 0,
    observed: false,
    observeResponse: null,
    frameDeliveredAt: 0,
    correctedStep: null,
    closedStep: null,
    findingTurn: null,
    lastWrittenKey: null,
    lastCheckpointKey: null,
    onCorrection: opts.onCorrection,
  };
}

export function createBotToolQueue(opts: {
  moveLimit: number;
  moveEnabled: boolean;
  handlers: BotSessionHandlers;
  requireCompleteReasoning?: boolean;
  onCorrection?: QueueState['onCorrection'];
  onDispatch?: (audit: ToolDispatchAudit) => void;
}): BotToolQueue {
  const ac = new AbortController();
  const st = initialState(opts, ac.signal);
  let tail: Promise<unknown> = Promise.resolve();

  function dispatch(toolName: string, rawArgs: unknown): Promise<ToolResponsePayload> {
    const startedAt = Date.now();
    const enqueuedAt = performance.now();
    const next = tail.then(async () => {
      const checkpoints = st.checkpoints;
      let result: ToolResponsePayload | undefined;
      let error: string | undefined;
      try {
        const response = await executeQueuedTool(st, toolName, rawArgs, enqueuedAt);
        const remaining = Math.max(0, Math.floor(st.handlers.getRemainingTimeSec()));
        const urgent = remaining <= 15 && !st.finalized && !st.signal.aborted;
        result = {
          ...response,
          text: `${response.text}\nОсталось времени: ${remaining} с.${urgent ? ' Немедленно отправь лучшую версию через final_guess с выводом по последнему кадру.' : ''}`,
        };
        return result;
      } catch (err) {
        try {
          error = err instanceof Error ? err.message : String(err);
        } catch {
          error = 'Unprintable error';
        }
        throw err;
      } finally {
        emitDispatchAudit(
          opts.onDispatch,
          {
            tool: toolName,
            args: rawArgs,
            durationMs: Date.now() - startedAt,
            checkpointSaved: st.checkpoints > checkpoints,
            ...(error !== undefined ? { error } : {}),
          },
          result,
        );
      }
    });
    tail = next.catch(() => undefined);
    return next;
  }

  return {
    dispatch,
    getTurnsUsed: () => st.turnsUsed,
    getFailedCalls: () => st.failedCalls,
    abort: (reason) => {
      if (!ac.signal.aborted) {
        ac.abort(new Error(reason));
      }
    },
  };
}
