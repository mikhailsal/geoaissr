import type { JournalStepPatch } from '../../../shared/bot-journal.ts';
import type { BotTurnThumbView } from '../../../shared/bot-results.ts';
import type { RoundTarget } from '../../engine/types.ts';
import type { BotImageService, RenderedBotImage } from '../../images/bot-image-service.ts';
import type { LocationService } from '../../location.ts';
import { createMoveTracker } from '../move.ts';
import type { FindingRecord } from '../queue-state.ts';
import { createDetectiveSession, type DetectiveSession } from './session.ts';
import type { DetectiveGuess, SessionOptions } from './state.ts';

/** Fixtures shared by the Detective tests: a session over tiny frames that records its sink. */

export const TARGET: RoundTarget = {
  panoId: 'p1',
  lat: 35,
  lng: 139,
  countryId: 'JP',
  countryNameRu: 'Япония',
  map: 'standard',
  region: 'world',
  fakeSceneIndex: 0,
};

function frame(label: string): RenderedBotImage {
  return {
    jpeg: Buffer.from('jpeg'),
    thumbId: label,
    thumbUrl: `/thumb/${label}`,
    fullId: label,
    fullUrl: `/full/${label}`,
    label,
  };
}

export function stubImageService(): BotImageService {
  return {
    prepareStartViews: () => Promise.resolve(),
    getObserveViews: () => Promise.resolve(['С', 'В', 'Ю', 'З'].map((d) => frame(`вид ${d}`))),
    getLookView: (o) => Promise.resolve(frame(`курс ${o.heading}°`)),
    getMoveView: (o) => Promise.resolve(frame(`шаг ${o.step}`)),
    clearRound: () => undefined,
  };
}

/** What the session reported, in order, as the launcher would turn it into engine events. */
export interface SinkLog {
  frames: BotTurnThumbView[];
  turns: number[];
  steps: Array<{ turn: number; patch: JournalStepPatch }>;
  findings: FindingRecord[];
  guesses: Array<{ guess: DetectiveGuess; finalized: boolean }>;
  corrections: Array<{
    role: string;
    tool: string;
    reason: string;
    missing?: readonly string[];
    code?: string;
  }>;
}

export interface TestSession {
  session: DetectiveSession;
  log: SinkLog;
  /** Moves the clock: the budget left for the bot, in milliseconds. */
  setRemainingMs: (ms: number) => void;
}

export function makeSession(overrides: Partial<SessionOptions> = {}): TestSession {
  const log: SinkLog = {
    frames: [],
    turns: [],
    steps: [],
    findings: [],
    guesses: [],
    corrections: [],
  };
  const clock = { remainingMs: 90_000 };
  const moveEnabled = overrides.moveEnabled ?? true;
  const session = createDetectiveSession({
    imageService: stubImageService(),
    tracker: createMoveTracker({
      initial: TARGET,
      moveEnabled,
      fakeMode: true,
      // Fake mode never asks the location service for a road.
      locationService: {} as LocationService,
    }),
    target: TARGET,
    imageSize: 640,
    moveLimit: 4,
    moveEnabled,
    getRemainingMs: () => clock.remainingMs,
    waitStart: () => Promise.resolve(),
    sink: {
      frame: (thumb) => log.frames.push(thumb),
      turns: (n) => log.turns.push(n),
      step: (turn, patch) => log.steps.push({ turn, patch }),
      finding: (record) => log.findings.push(record),
      guess: (guess, finalized) => log.guesses.push({ guess, finalized }),
      correction: (info) => log.corrections.push(info),
    },
    askTimeoutMs: 2000,
    briefingWaitMs: 300,
    nextRequestWaitMs: 50,
    ...overrides,
  });
  return {
    session,
    log,
    setRemainingMs: (ms) => {
      clock.remainingMs = ms;
    },
  };
}

export const REPORT = {
  sections: {
    texts: [{ text: '«LAWSON» — вывеска на японском магазине', frame: 1 }],
    road: [{ text: 'Сторона движения: левая — машины стоят слева', frame: 2 }],
  },
};

export const ASK = {
  hypothesis: 'Вывеска и сторона движения разделят версии.',
  requests: [
    { kind: 'describe', topic: 'номера машин: форма и цвета' },
    { kind: 'text', target: 'синяя табличка на доме, кадр 2' },
  ],
  finding: 'В отчёте есть вывеска латиницей и левосторонняя парковка.',
  current_guess: { lat: 35, lng: 139 },
};

export const FINAL = {
  lat: 35.2,
  lng: 139.4,
  summary: 'Я прочитал отчёт и ответы напарника.',
  finding: 'Вывеска решила.',
  confidence: 'country',
  clue: 'Вывеска латиницей.',
};

/** A session whose eyes filed the report and whose brain has read it. */
export async function briefed(overrides: Partial<SessionOptions> = {}): Promise<TestSession> {
  const t = makeSession(overrides);
  await t.session.call('eyes', 'observe', {});
  await t.session.call('eyes', 'report', REPORT);
  await t.session.call('brain', 'briefing', {});
  return t;
}

/** Waits for a state the code under test reaches on its own, without a fixed pause. */
export async function until(reached: () => boolean): Promise<void> {
  while (!reached()) await new Promise((resolve) => setTimeout(resolve, 1));
}

/** A gate a test opens by hand: the round start, or a camera frame that takes its time. */
export function manualGate(): { wait: () => Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait: () => opened, open };
}

/** The eyes take the outstanding request and answer it. */
export async function answerCurrent(
  session: DetectiveSession,
  answers: unknown[],
): Promise<Awaited<ReturnType<DetectiveSession['call']>>> {
  await session.call('eyes', 'next_request', {});
  const request = session.state.broker.current();
  if (!request) throw new Error('no request is outstanding');
  return session.call('eyes', 'answer', { request_id: request.id, answers });
}
