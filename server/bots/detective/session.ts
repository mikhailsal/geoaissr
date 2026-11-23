import type { DetectiveRole } from '../../../shared/detective-tools.ts';
import { handleAsk, handleBriefing, handleFinalGuess } from './brain.ts';
import {
  handleAnswer,
  handleLook,
  handleMove,
  handleNextRequest,
  handleObserve,
  handleReport,
} from './eyes.ts';
import {
  createSessionState,
  errorReply,
  roundOver,
  wakeReportWaiters,
  type SessionOptions,
  type SessionState,
  type ToolReply,
} from './state.ts';

/**
 * One Detective round on the server side. The role is fixed by the token, so the brain cannot
 * reach camera tools and never receives an image; the eyes cannot ask or guess.
 *
 *   eyes:  observe ─► look/move (short hunt) ─► report ─► next_request ◄─► answer ─┐
 *   brain: briefing (waits for the report) ─► ask ◄──── answers ───────────────────┘
 *                                             └─► final_guess (ends the round)
 */
export interface DetectiveSession {
  state: SessionState;
  call: (role: DetectiveRole, tool: string, args: unknown) => Promise<ToolReply>;
  /** The eyes process exited: the outstanding ask and every later one settle as eyes_down. */
  eyesExited: () => void;
  /** Ends the round for both roles: waits wake up and later calls are refused. */
  end: () => void;
  submittedGuess: () => boolean;
  turnsUsed: () => number;
}

function dispatchBrain(s: SessionState, tool: string, args: unknown): Promise<ToolReply> {
  switch (tool) {
    case 'briefing':
      return handleBriefing(s);
    case 'ask':
      return handleAsk(s, args);
    case 'final_guess':
      return Promise.resolve(handleFinalGuess(s, args));
    default:
      return Promise.resolve(errorReply(`Инструмент ${tool} недоступен мозгу.`));
  }
}

function dispatchEyes(s: SessionState, tool: string, args: unknown): Promise<ToolReply> {
  switch (tool) {
    case 'observe':
      return handleObserve(s);
    case 'look':
      return handleLook(s, args);
    case 'move':
      return handleMove(s, args);
    case 'report':
      return Promise.resolve(handleReport(s, args));
    case 'next_request':
      return handleNextRequest(s);
    case 'answer':
      return Promise.resolve(handleAnswer(s, args));
    default:
      return Promise.resolve(errorReply(`Инструмент ${tool} недоступен глазам.`));
  }
}

export function createDetectiveSession(opts: SessionOptions): DetectiveSession {
  const s = createSessionState(opts);
  // One call at a time per role: frame numbers and paid turns never race.
  const tails: Record<DetectiveRole, Promise<unknown>> = {
    brain: Promise.resolve(),
    eyes: Promise.resolve(),
  };
  return {
    state: s,
    call(role, tool, args) {
      const run = (): Promise<ToolReply> =>
        role === 'brain' ? dispatchBrain(s, tool, args) : dispatchEyes(s, tool, args);
      const next = tails[role].then(run, run);
      tails[role] = next.catch(() => undefined);
      return next;
    },
    eyesExited() {
      // An exit after the round ended is the normal shutdown, not an eyes failure.
      if (!roundOver(s)) s.eyesDown = true;
      s.broker.eyesDown();
      wakeReportWaiters(s);
    },
    end() {
      s.ended = true;
      s.abort.abort();
      s.broker.close();
      wakeReportWaiters(s);
    },
    submittedGuess: () => s.submittedGuess,
    turnsUsed: () => s.turnsUsed,
  };
}
