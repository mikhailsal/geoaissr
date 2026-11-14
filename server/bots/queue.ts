import {
  formatToolZodError,
  lookInputSchema,
  moveInputSchema,
  normalizeSubmitGuessInput,
  observeInputSchema,
  submitGuessInputSchema,
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
  }) => Promise<ToolResponsePayload>;
  executeMove: (args: { heading: number }) => Promise<ToolResponsePayload>;
  onGuess: (guess: NormalizedGuessInput) => void;
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
}

function recordQueueFailure(
  st: QueueState,
  baseMsg: string,
  spendTurnNote?: string,
): ToolResponsePayload {
  st.failedCalls += 1;
  if (st.failedCalls > 3 && st.turnsUsed < st.moveLimit) {
    st.turnsUsed += 1;
    st.handlers.onTurnsChanged(st.turnsUsed);
    const rem = Math.max(0, st.moveLimit - st.turnsUsed);
    return {
      text: `${baseMsg}\nПревышен порог бесплатных ошибок (>3): списан 1 ход (осталось ${rem}).`,
      isError: true,
    };
  }
  const note =
    spendTurnNote ?? `Ход не списан (ошибок без штрафа: ${Math.min(st.failedCalls, 3)}/3).`;
  return { text: `${baseMsg}\n${note}`, isError: true };
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

async function executeQueuedTool(
  st: QueueState,
  toolName: string,
  rawArgs: unknown,
): Promise<ToolResponsePayload> {
  if (isSignalAborted(st.signal)) {
    return { text: 'Раунд уже завершён.', isError: true };
  }

  if (toolName === 'observe') {
    const parsed = observeInputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
    if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
    return st.handlers.executeObserve();
  }

  if (toolName === 'submit_guess') {
    const parsed = submitGuessInputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
    if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
    const norm = normalizeSubmitGuessInput(parsed.data);
    st.handlers.onGuess(norm);
    const remMoves = Math.max(0, st.moveLimit - st.turnsUsed);
    const remSec = Math.max(0, Math.round(st.handlers.getRemainingTimeSec()));
    return {
      text: `Догадка принята (${norm.lat.toFixed(3)}, ${norm.lng.toFixed(3)}). Осталось ходов: ${remMoves}, до конца бюджета: ${remSec} с.`,
    };
  }

  if (toolName === 'look') {
    const parsed = lookInputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
    if (st.turnsUsed >= st.moveLimit) {
      return {
        text: `Лимит ходов (${st.moveLimit}) исчерпан. Отправьте догадку через submit_guess.`,
        isError: true,
      };
    }
    if (!(await awaitRoundStart(st))) return { text: 'Раунд уже завершён.', isError: true };
    const res = await st.handlers.executeLook(parsed.data);
    if (res.isError) return recordQueueFailure(st, res.text);
    st.turnsUsed += 1;
    st.handlers.onTurnsChanged(st.turnsUsed);
    return res;
  }

  if (toolName === 'move') {
    if (!st.moveEnabled) {
      return recordQueueFailure(st, 'Движение (move) отключено в этой партии.');
    }
    const parsed = moveInputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) return recordQueueFailure(st, formatToolZodError(parsed.error));
    if (st.turnsUsed >= st.moveLimit) {
      return {
        text: `Лимит ходов (${st.moveLimit}) исчерпан. Отправьте догадку через submit_guess.`,
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
  };
  let tail: Promise<unknown> = Promise.resolve();

  function dispatch(toolName: string, rawArgs: unknown): Promise<ToolResponsePayload> {
    const next = tail.then(() => executeQueuedTool(st, toolName, rawArgs));
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
