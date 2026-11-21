import { randomBytes } from 'node:crypto';
import { isAbstain } from './catalog.ts';

/**
 * Request broker between the brain and the eyes, owned by the server and separate from any
 * camera queue.
 *
 *   brain ask ──► pending request (one at a time, id) ──► eyes next_request (blocking)
 *        ▲                                                     │
 *        └──── settled exactly once: answer | timeout | eyes_down | closed ◄── eyes answer
 *
 * A late answer (after a timeout or a second answer for the same id) is dropped.
 */

export type QuestionStatus = 'answered' | 'abstained' | 'timeout' | 'eyes_down';

export type Question = { kind: 'feature'; feature: string } | { kind: 'text'; target: string };

export interface AnswerItem {
  /** 1-based number of the question in the request. */
  n: number;
  value: string;
  frame: number | null;
}

export interface SettledItem {
  n: number;
  question: Question;
  status: QuestionStatus;
  value: string | null;
  frame: number | null;
}

export type SettledBy = 'answer' | 'timeout' | 'eyes_down' | 'closed';

export interface AskOutcome {
  requestId: string;
  items: SettledItem[];
  /** From the ask to its settlement. */
  cycleMs: number;
  settledBy: SettledBy;
}

export interface BrokerRequest {
  id: string;
  questions: Question[];
}

export class BrokerBusyError extends Error {
  constructor() {
    super('A request is already outstanding');
    this.name = 'BrokerBusyError';
  }
}

interface Pending {
  id: string;
  questions: Question[];
  createdAt: number;
  delivered: boolean;
  resolve: (outcome: AskOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type AnswerResult = 'settled' | 'late' | 'unknown';

export interface Broker {
  ask: (questions: Question[], timeoutMs: number) => Promise<AskOutcome>;
  /** The outstanding request, or the next one to arrive within `waitMs`; null when none. */
  nextRequest: (waitMs: number) => Promise<BrokerRequest | null>;
  answer: (requestId: string, items: readonly AnswerItem[]) => AnswerResult;
  /** The eyes process is gone: settle the outstanding request and every later one at once. */
  eyesDown: () => void;
  /** The round ended: settle the outstanding request and wake waiting eyes. */
  close: () => void;
  hasPending: () => boolean;
  /** The outstanding request without delivering it; null when none. */
  current: () => BrokerRequest | null;
}

function statusOf(item: AnswerItem | undefined): QuestionStatus {
  if (!item) return 'timeout';
  return isAbstain(item.value) ? 'abstained' : 'answered';
}

function settleItems(
  questions: readonly Question[],
  items: readonly AnswerItem[] | null,
  fallback: QuestionStatus,
): SettledItem[] {
  return questions.map((question, idx) => {
    const n = idx + 1;
    if (items === null) return { n, question, status: fallback, value: null, frame: null };
    const item = items.find((i) => i.n === n);
    return {
      n,
      question,
      status: statusOf(item),
      value: item?.value ?? null,
      frame: item?.frame ?? null,
    };
  });
}

interface Core {
  now: () => number;
  newId: () => string;
  pending: Pending | null;
  eyesGone: boolean;
  closed: boolean;
  settledIds: Set<string>;
  waiters: Array<() => void>;
}

function wake(core: Core): void {
  while (core.waiters.length > 0) core.waiters.shift()?.();
}

function settle(
  core: Core,
  p: Pending,
  items: readonly AnswerItem[] | null,
  by: SettledBy,
  fallback: QuestionStatus,
): void {
  clearTimeout(p.timer);
  core.pending = null;
  core.settledIds.add(p.id);
  p.resolve({
    requestId: p.id,
    items: settleItems(p.questions, items, fallback),
    cycleMs: core.now() - p.createdAt,
    settledBy: by,
  });
}

function openRequest(core: Core, questions: Question[], timeoutMs: number): Promise<AskOutcome> {
  return new Promise<AskOutcome>((resolve) => {
    const p: Pending = {
      id: core.newId(),
      questions,
      createdAt: core.now(),
      delivered: false,
      resolve,
      timer: setTimeout(() => {
        if (core.pending === p) settle(core, p, null, 'timeout', 'timeout');
      }, timeoutMs),
    };
    core.pending = p;
    wake(core);
  });
}

/** An eyes process that asks again before answering gets the same request again. */
function take(core: Core): BrokerRequest | null {
  if (!core.pending || core.closed) return null;
  core.pending.delivered = true;
  return { id: core.pending.id, questions: core.pending.questions };
}

async function waitForRequest(core: Core, waitMs: number): Promise<BrokerRequest | null> {
  const ready = take(core);
  if (ready || core.closed) return ready;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    core.waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  return take(core);
}

export function createBroker(opts: { now?: () => number; newId?: () => string } = {}): Broker {
  const core: Core = {
    now: opts.now ?? Date.now,
    newId: opts.newId ?? (() => randomBytes(4).toString('hex')),
    pending: null,
    eyesGone: false,
    closed: false,
    settledIds: new Set(),
    waiters: [],
  };
  const immediate = (questions: Question[], by: SettledBy, status: QuestionStatus) =>
    Promise.resolve<AskOutcome>({
      requestId: core.newId(),
      items: settleItems(questions, null, status),
      cycleMs: 0,
      settledBy: by,
    });
  return {
    ask(questions, timeoutMs) {
      if (core.pending) return Promise.reject(new BrokerBusyError());
      if (core.eyesGone) return immediate(questions, 'eyes_down', 'eyes_down');
      if (core.closed || timeoutMs <= 0) return immediate(questions, 'closed', 'timeout');
      return openRequest(core, questions, timeoutMs);
    },
    nextRequest: (waitMs) => waitForRequest(core, waitMs),
    answer(requestId, items) {
      if (core.pending?.id === requestId) {
        settle(core, core.pending, items, 'answer', 'timeout');
        return 'settled';
      }
      return core.settledIds.has(requestId) ? 'late' : 'unknown';
    },
    eyesDown() {
      core.eyesGone = true;
      if (core.pending) settle(core, core.pending, null, 'eyes_down', 'eyes_down');
      wake(core);
    },
    close() {
      core.closed = true;
      if (core.pending) settle(core, core.pending, null, 'closed', 'timeout');
      wake(core);
    },
    hasPending: () => core.pending !== null,
    current: () =>
      core.pending ? { id: core.pending.id, questions: core.pending.questions } : null,
  };
}
