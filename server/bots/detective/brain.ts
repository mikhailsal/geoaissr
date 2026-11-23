import {
  formatToolZodError,
  normalizeLongitude,
  parseGuessInput,
} from '../../../shared/bot-tools.ts';
import {
  detectiveAskSchema,
  hasQuestionForm,
  parseFinalExtras,
  type DetectiveAskInput,
} from '../../../shared/detective-tools.ts';
import type { ErrorCode } from '../../errors.ts';
import { JOURNAL_FIELD_MISSING_CODE } from '../queue-journal.ts';
import type { AskOutcome, Question } from './broker.ts';
import {
  brainStatusLines,
  formatAskOutcome,
  formatReport,
  journalRequests,
  requestText,
} from './format.ts';
import { maskPlaceWords } from './guard.ts';
import {
  ASK_TIMEOUT_MS,
  BRIEFING_WAIT_MS,
  CONTROL_MIN_LEFT_MS,
  DRIVE_ASK_TIMEOUT_MS,
  MIN_REMAINING_MS,
  errorReply,
  remainingMs,
  roundOver,
  secondsLeft,
  turnsLeft,
  wakeReportWaiters,
  type SessionState,
  type ToolReply,
} from './state.ts';

/**
 * Brain tools: `briefing` returns the eyes' scene report, `ask` sends requests that name a topic,
 * `final_guess` ends the round. The brain never receives an image.
 */

const ROUND_OVER_TEXT = 'Раунд окончен: новые вызовы не принимаются.';

const minRemaining = (s: SessionState): number => s.opts.minRemainingMs ?? MIN_REMAINING_MS;

function waitForReport(s: SessionState): Promise<void> {
  const waitMs = Math.min(
    s.opts.briefingWaitMs ?? BRIEFING_WAIT_MS,
    remainingMs(s) - minRemaining(s),
  );
  if (waitMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    s.reportWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function handleBriefing(s: SessionState): Promise<ToolReply> {
  await s.opts.waitStart(s.abort.signal);
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  if (s.report === null && !s.eyesDown) await waitForReport(s);
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  if (s.report === null) {
    if (s.eyesDown) {
      return errorReply(
        'Отчёта нет: процесс напарника завершился. Немедленно вызови final_guess с лучшей догадкой.',
      );
    }
    if (remainingMs(s) <= 2 * minRemaining(s)) {
      return errorReply(
        `Отчёт не готов, осталось ${secondsLeft(s)} с. Немедленно вызови final_guess с лучшей догадкой.`,
      );
    }
    return { text: `Отчёт ещё не готов. Осталось ${secondsLeft(s)} с. Вызови briefing снова.` };
  }
  s.briefed = true;
  return {
    text: [
      'Отчёт напарника о сцене (текст в «…» переписан со снимков дословно; […] — слово, скрытое сервером):',
      formatReport(s, s.report),
      ...brainStatusLines(s),
    ].join('\n'),
  };
}

/** Codes at the start of the brain's corrections; registered in server/errors.ts. */
const QUESTION_FORM_CODE: ErrorCode = 'GEO_DETECTIVE_QUESTION_FORM';
const PLACE_WORD_CODE: ErrorCode = 'GEO_DETECTIVE_PLACE_WORD';
const CONTROL_MISSING_CODE: ErrorCode = 'GEO_DETECTIVE_CONTROL_MISSING';

/** A request that asks a question or names a place is refused and not counted. */
function guardRequests(s: SessionState, requests: readonly Question[]): ToolReply | null {
  for (const q of requests) {
    const text = requestText(q);
    if (hasQuestionForm(text)) {
      return errorReply(
        `[${QUESTION_FORM_CODE}] Запрос не отправлен: «${text}» — это вопрос. Назови тему, на которую посмотреть, без «?» и без «ли», например «люди на улице: одежда, чем заняты»: напарник сам опишет, что там видно. Отклонённый запрос не засчитан.`,
      );
    }
    const word = s.guard.findPlaceWord(text);
    if (word !== null) {
      return errorReply(
        `[${PLACE_WORD_CODE}] Запрос не отправлен: в тексте «${text}» есть название места или народа («${word}»). Правило: напарнику нельзя подсказывать место. Перефразируй без названий мест и народов (названия письменностей можно: «грузинское письмо»), например «самая крупная вывеска». Отклонённый запрос не засчитан.`,
      );
    }
  }
  return null;
}

/** A drive costs the eyes a paid action; one ask carries at most one. */
function driveProblem(s: SessionState, requests: readonly Question[]): ToolReply | null {
  const drives = requests.filter((q) => q.kind === 'drive').length;
  if (drives === 0) return null;
  if (!s.opts.moveEnabled) {
    return errorReply(
      'Запрос не отправлен: движение по дороге выключено в этой партии. Убери просьбу drive.',
    );
  }
  if (drives > 1) {
    return errorReply('Запрос не отправлен: в одном ask может быть только один проезд (drive).');
  }
  if (turnsLeft(s) === 0) {
    return errorReply(
      'Запрос не отправлен: у напарника не осталось платных ходов, проехать он не сможет. Убери просьбу drive.',
    );
  }
  return null;
}

/** Every ask owes `finding` and `current_guess`: the brain has read the report by then. */
function journalCorrection(s: SessionState, input: DetectiveAskInput): ToolReply | null {
  const missing = [
    ...(input.finding ? [] : ['finding']),
    ...(input.current_guess ? [] : ['current_guess']),
  ];
  const key = `ask:${s.asks + 1}`;
  if (missing.length === 0 || s.correctionsUsed.has(key)) return null;
  s.correctionsUsed.add(key);
  s.opts.sink.correction?.({ role: 'brain', tool: 'ask', reason: missing.join(',') });
  const source = s.asks === 0 ? 'отчёта' : 'ответов на предыдущий запрос';
  return errorReply(
    `[${JOURNAL_FIELD_MISSING_CODE}] ask: не хватает полей: ${missing.join(', ')}. В finding напиши, что нового ты узнал из ${source} и что это меняет; в current_guess — твою лучшую точку. Запрос не отправлен. Исправление одно на шаг: повтори вызов с этими полями.`,
  );
}

function checkpoint(s: SessionState, point: { lat: number; lng: number }): void {
  s.submittedGuess = true;
  s.opts.sink.guess({ lat: point.lat, lng: point.lng, explanation: '' }, false);
}

/** The finding an ask carries belongs to the step before it, like a camera bot's `finding`. */
function recordStepFinding(s: SessionState, input: DetectiveAskInput): void {
  const point = input.current_guess
    ? { lat: input.current_guess.lat, lng: normalizeLongitude(input.current_guess.lng) }
    : null;
  s.opts.sink.finding({
    turn: s.asks,
    findingState: input.finding ? 'recorded' : 'missing',
    ...(input.finding ? { finding: input.finding } : {}),
    ...(input.shifts?.length ? { shifts: input.shifts } : {}),
    ...(point ? { currentGuess: point } : { pointMissing: true as const }),
  });
  if (point) checkpoint(s, point);
}

/** The outcome as the brain reads it: place words in the eyes' own words are masked. */
function maskOutcome(s: SessionState, outcome: AskOutcome): AskOutcome {
  const items = outcome.items.map((item) => {
    if (item.question.kind === 'text' || item.status !== 'answered' || item.value === null) {
      return item;
    }
    return { ...item, value: maskPlaceWords(s.guard, item.value).text };
  });
  return { ...outcome, items };
}

function askWaitMs(s: SessionState, requests: readonly Question[]): number {
  const drive = requests.some((q) => q.kind === 'drive');
  const timeout = s.opts.askTimeoutMs ?? (drive ? DRIVE_ASK_TIMEOUT_MS : ASK_TIMEOUT_MS);
  return Math.min(timeout, remainingMs(s) - minRemaining(s));
}

export async function handleAsk(s: SessionState, args: unknown): Promise<ToolReply> {
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  if (!s.briefed) {
    return errorReply('Сначала вызови briefing: без отчёта напарника запрос не отправится.');
  }
  const parsed = detectiveAskSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const requests: Question[] = parsed.data.requests;
  const blocked =
    guardRequests(s, requests) ?? driveProblem(s, requests) ?? journalCorrection(s, parsed.data);
  if (blocked) return blocked;
  const waitMs = askWaitMs(s, requests);
  if (waitMs <= 0) {
    return errorReply(
      'Осталось меньше 10 с: запрос не отправлен. Немедленно вызови final_guess с лучшей точкой.',
    );
  }
  if (s.broker.hasPending()) {
    return errorReply('Предыдущий запрос ещё не закрыт: дождись его ответа.');
  }
  recordStepFinding(s, parsed.data);
  s.asks += 1;
  const turn = s.asks;
  const control = parsed.data.control === true;
  if (control) s.controlAsked = true;
  s.opts.sink.step(turn, {
    reason: parsed.data.hypothesis,
    requests: journalRequests(requests, null),
    ...(control ? { control: true as const } : {}),
  });
  const outcome = maskOutcome(s, await s.broker.ask(requests, waitMs));
  s.opts.sink.step(turn, { requests: journalRequests(requests, outcome.items) });
  const text = formatAskOutcome(s, outcome);
  if (outcome.settledBy === 'eyes_down') {
    return errorReply(`${text}\nНапарник больше не отвечает. Немедленно вызови final_guess.`);
  }
  return { text };
}

/**
 * The control check. A `final_guess` that comes before any control ask, with time left for one,
 * is refused once with a reminder; its point is kept as a checkpoint. A second `final_guess` is
 * accepted: the brain decides.
 */
function controlReminder(s: SessionState, guess: { lat: number; lng: number }): ToolReply | null {
  if (s.controlAsked || !s.briefed || s.eyesDown) return null;
  if (remainingMs(s) <= CONTROL_MIN_LEFT_MS || s.correctionsUsed.has('final:control')) return null;
  s.correctionsUsed.add('final:control');
  s.opts.sink.correction?.({ role: 'brain', tool: 'final_guess', reason: 'control' });
  checkpoint(s, guess);
  return errorReply(
    `[${CONTROL_MISSING_CODE}] Точка сохранена как промежуточная, раунд не окончен: контрольной проверки ещё не было, а до конца раунда ${secondsLeft(s)} с. Отправь ask с control: true: попроси напарника ещё раз посмотреть туда, где был решающий признак, и добавь просьбы о том, чего ты ещё не знаешь. Если повторишь final_guess без проверки, он будет принят.`,
  );
}

export function handleFinalGuess(s: SessionState, args: unknown): ToolReply {
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  const guess = parseGuessInput(args);
  if (!guess) return errorReply('final_guess: нужны числовые lat и lng. Догадка не записана.');
  const reminder = controlReminder(s, guess);
  if (reminder) return reminder;
  const extras = parseFinalExtras(args);
  const missing = [
    ...(guess.summary ? [] : ['summary']),
    ...(guess.finding ? [] : ['finding']),
    ...(extras.confidence === null ? ['confidence (country | region | guess)'] : []),
    ...(extras.clue === null ? ['clue'] : []),
  ];
  if (missing.length > 0 && !s.correctionsUsed.has('final')) {
    s.correctionsUsed.add('final');
    s.opts.sink.correction?.({ role: 'brain', tool: 'final_guess', reason: missing.join(',') });
    checkpoint(s, guess);
    return errorReply(
      `[${JOURNAL_FIELD_MISSING_CODE}] final_guess: не хватает полей: ${missing.join(', ')}. Точка сохранена как промежуточная. Повтори final_guess с этими полями.`,
    );
  }
  const { finding, shifts, ...point } = guess;
  s.final = true;
  s.submittedGuess = true;
  s.opts.sink.finding({
    turn: s.asks,
    findingState: finding ? 'recorded' : 'missing',
    ...(finding ? { finding } : {}),
    ...(shifts ? { shifts } : {}),
  });
  s.opts.sink.guess(
    {
      ...point,
      ...(extras.confidence ? { confidence: extras.confidence } : {}),
      ...(extras.clue ? { clue: extras.clue } : {}),
    },
    true,
  );
  s.broker.close();
  s.abort.abort();
  wakeReportWaiters(s);
  return { text: 'Догадка принята. Раунд для тебя окончен.' };
}
