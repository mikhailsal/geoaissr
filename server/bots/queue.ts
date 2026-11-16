import {
  formatToolZodError,
  lookInputSchema,
  moveInputSchema,
  parseGuessInput,
  observeInputSchema,
  type NormalizedGuessInput,
} from '../../shared/bot-tools.ts';

export interface ToolResponsePayload {
  text: string;
  images?: Array<{ name: string; base64: string; mimeType: string }>;
  isError?: boolean;
}

export interface BotSessionHandlers {
  waitObserveRelease: (signal: AbortSignal) => Promise<void>;
  executeObserve: () => Promise<ToolResponsePayload>;
  executeLook: (args: {
    heading: number;
    pitch: number;
    fov: number;
    hypothesis?: string;
  }) => Promise<ToolResponsePayload>;
  executeMove: (args: { heading: number; hypothesis?: string }) => Promise<ToolResponsePayload>;
  onGuess: (guess: NormalizedGuessInput, finalized: boolean) => void;
  onTurnsChanged: (turnsUsed: number) => void;
  getRemainingTimeSec: () => number;
}

export interface BotToolQueue {
  dispatch: (toolName: string, rawArgs: unknown) => Promise<ToolResponsePayload>;
  getTurnsUsed: () => number;
  getFailedCalls: () => number;
  abort: (reason: string) => void;
}

interface QueueState {
  moveLimit: number;
  moveEnabled: boolean;
  handlers: BotSessionHandlers;
  signal: AbortSignal;
  turnsUsed: number;
  failedCalls: number;
  roundStartedPromise: Promise<void> | null;
  finalized: boolean;
  requireCompleteReasoning: boolean;
}

function recordQueueFailure(st: QueueState, baseMsg: string): ToolResponsePayload {
  st.failedCalls += 1;
  return { text: `${baseMsg}\nХод не списан.`, isError: true };
}

function optionalHypothesis(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const data = { ...raw } as Record<string, unknown>;
  const parsed = lookInputSchema.shape.hypothesis.safeParse(data.hypothesis);
  if (parsed.success) data.hypothesis = parsed.data;
  else delete data.hypothesis;
  return data;
}

function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function awaitRoundStart(st: QueueState): Promise<boolean> {
  if (isSignalAborted(st.signal)) return false;
  st.roundStartedPromise ??= st.handlers.waitObserveRelease(st.signal);
  try {
    await st.roundStartedPromise;
  } catch {
    return false;
  }
  return !isSignalAborted(st.signal);
}

async function executeGuess(
  st: QueueState,
  toolName: string,
  rawArgs: unknown,
): Promise<ToolResponsePayload> {
  const guess = parseGuessInput(rawArgs);
  if (!guess) return recordQueueFailure(st, 'Неверные координаты догадки.');
  if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
  const missingReasoning =
    toolName !== 'submit_guess' && !guess.facts && !guess.conclusion && !guess.explanation;
  const incompleteFinal =
    toolName === 'final_guess' &&
    st.requireCompleteReasoning &&
    (!guess.facts || !guess.conclusion || !guess.rejectedGuesses);
  const finalized = toolName !== 'draft_guess' && !missingReasoning && !incompleteFinal;
  st.handlers.onGuess(guess, finalized);
  st.finalized = finalized;
  if (incompleteFinal) {
    return {
      text: 'Координаты сохранены как черновик. Повтори final_guess с lat, lng, непустыми facts и conclusion и списком rejected_guesses; если обоснованных исключённых версий нет, укажи [].',
      isError: true,
    };
  }
  if (missingReasoning) {
    return {
      text: 'Координаты сохранены как черновик. Добавь непустое объяснение: facts (до 1000 символов) или conclusion (до 600); повтори вызов с lat и lng.',
      ...(toolName === 'final_guess' ? { isError: true } : {}),
    };
  }
  const remMoves = Math.max(0, st.moveLimit - st.turnsUsed);
  const remSec = Math.max(0, Math.round(st.handlers.getRemainingTimeSec()));
  return {
    text: finalized
      ? 'Окончательная догадка принята.'
      : `Черновик сохранён. Осталось ходов: ${remMoves}, времени: ${remSec} с.${remSec > 15 ? ' Продолжай исследование, если не уверен окончательно.' : ''}`,
  };
}

async function executeQueuedTool(
  st: QueueState,
  toolName: string,
  rawArgs: unknown,
): Promise<ToolResponsePayload> {
  if (isSignalAborted(st.signal)) {
    return { text: 'Раунд уже завершён.', isError: true };
  }

  if (st.finalized) return { text: 'Окончательная догадка уже отправлена.', isError: true };

  if (toolName === 'observe') {
    const parsed = observeInputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
    if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
    return st.handlers.executeObserve();
  }

  if (toolName === 'submit_guess' || toolName === 'final_guess' || toolName === 'draft_guess') {
    return executeGuess(st, toolName, rawArgs);
  }

  if (toolName === 'look') {
    const parsed = lookInputSchema
      .extend({ hypothesis: lookInputSchema.shape.hypothesis.optional() })
      .safeParse(optionalHypothesis(rawArgs ?? {}));
    if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
    if (st.turnsUsed >= st.moveLimit) {
      return {
        text: `Лимит ходов (${st.moveLimit}) исчерпан. Отправьте догадку через final_guess.`,
        isError: true,
      };
    }
    if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
    const { fov, zoom, ...rest } = parsed.data;
    const effectiveFov = Math.max(10, Math.min(120, fov ?? (zoom ? Math.round(90 / zoom) : 90)));
    const res = await st.handlers.executeLook({ ...rest, fov: effectiveFov });
    if (res.isError) return recordQueueFailure(st, res.text);
    st.turnsUsed += 1;
    st.handlers.onTurnsChanged(st.turnsUsed);
    return res;
  }

  if (toolName === 'move') {
    if (!st.moveEnabled) {
      return recordQueueFailure(st, 'Движение (move) отключено в этой партии.');
    }
    const parsed = moveInputSchema
      .extend({ hypothesis: moveInputSchema.shape.hypothesis.optional() })
      .safeParse(optionalHypothesis(rawArgs ?? {}));
    if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
    if (st.turnsUsed >= st.moveLimit) {
      return {
        text: `Лимит ходов (${st.moveLimit}) исчерпан. Отправьте догадку через final_guess.`,
        isError: true,
      };
    }
    if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
    const res = await st.handlers.executeMove(parsed.data);
    if (res.isError) return recordQueueFailure(st, res.text);
    st.turnsUsed += 1;
    st.handlers.onTurnsChanged(st.turnsUsed);
    return res;
  }

  return recordQueueFailure(st, `Неизвестный инструмент: ${toolName}`);
}

export function createBotToolQueue(opts: {
  moveLimit: number;
  moveEnabled: boolean;
  handlers: BotSessionHandlers;
  requireCompleteReasoning?: boolean;
}): BotToolQueue {
  const ac = new AbortController();
  const st: QueueState = {
    moveLimit: opts.moveLimit,
    moveEnabled: opts.moveEnabled,
    handlers: opts.handlers,
    signal: ac.signal,
    turnsUsed: 0,
    failedCalls: 0,
    roundStartedPromise: null,
    finalized: false,
    requireCompleteReasoning: opts.requireCompleteReasoning ?? false,
  };
  let tail: Promise<unknown> = Promise.resolve();

  function dispatch(toolName: string, rawArgs: unknown): Promise<ToolResponsePayload> {
    const next = tail.then(async () => {
      const result = await executeQueuedTool(st, toolName, rawArgs);
      const remaining = Math.max(0, Math.floor(st.handlers.getRemainingTimeSec()));
      const urgent = remaining <= 15 && !st.finalized && !st.signal.aborted;
      return {
        ...result,
        text: `${result.text}\nОсталось времени: ${remaining} с.${urgent ? ' Немедленно отправь лучшую версию через final_guess.' : ''}`,
      };
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
