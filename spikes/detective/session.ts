import { handleAsk, handleFinalGuess } from './brain.ts';
import { handleAnswer, handleLook, handleNextRequest, handleObserve } from './eyes.ts';
import type { Role } from './protocol.ts';
import { handleBriefing, handleReportAsk } from './report-brain.ts';
import { handleReport } from './report-eyes.ts';
import {
  createSessionState,
  elapsedMs,
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
 */
export interface DetectiveSession {
  state: SessionState;
  /** Starts the round clock (the observe release). */
  start: () => void;
  call: (role: Role, tool: string, args: unknown) => Promise<ToolReply>;
  /** The eyes process exited: pending and later asks settle as eyes_down. */
  eyesExited: () => void;
  /** Ends the round for both roles. */
  end: () => void;
  onFinal: (listener: () => void) => void;
}

async function dispatchBrain(s: SessionState, tool: string, args: unknown): Promise<ToolReply> {
  const report = s.opts.protocol === 'report';
  if (tool === 'briefing' && report) return handleBriefing(s);
  switch (tool) {
    case 'ask':
      return report ? handleReportAsk(s, args) : handleAsk(s, args);
    case 'final_guess':
      return Promise.resolve(handleFinalGuess(s, args));
    default:
      return Promise.resolve(errorReply(`Инструмент ${tool} недоступен мозгу.`));
  }
}

async function dispatchEyes(s: SessionState, tool: string, args: unknown): Promise<ToolReply> {
  if (tool === 'report' && s.opts.protocol === 'report') {
    return Promise.resolve(handleReport(s, args));
  }
  switch (tool) {
    case 'observe':
      return handleObserve(s);
    case 'look':
      return handleLook(s, args);
    case 'next_request':
      return handleNextRequest(s);
    case 'answer':
      return Promise.resolve(handleAnswer(s, args, s.broker.current()));
    default:
      return Promise.resolve(errorReply(`Инструмент ${tool} недоступен глазам.`));
  }
}

export function createDetectiveSession(opts: SessionOptions): DetectiveSession {
  const s = createSessionState(opts);
  return {
    state: s,
    start() {
      s.t0 = s.now();
    },
    async call(role, tool, args) {
      const reply =
        role === 'brain' ? await dispatchBrain(s, tool, args) : await dispatchEyes(s, tool, args);
      if (role === 'brain') {
        s.toolCalls.brain += 1;
        if (reply.isError) s.toolCalls.brainErrors += 1;
      } else {
        s.toolCalls.eyes += 1;
        if (reply.isError) s.toolCalls.eyesErrors += 1;
      }
      return reply;
    },
    eyesExited() {
      // An exit after the round ended is the normal shutdown, not an eyes failure.
      if (s.eyesDownAtMs === null && !roundOver(s)) s.eyesDownAtMs = elapsedMs(s);
      s.broker.eyesDown();
      wakeReportWaiters(s);
    },
    end() {
      s.ended = true;
      s.broker.close();
      wakeReportWaiters(s);
    },
    onFinal(listener) {
      if (s.final) listener();
      else s.finalListeners.push(listener);
    },
  };
}
