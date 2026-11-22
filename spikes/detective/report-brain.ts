import { formatToolZodError } from '../../shared/bot-tools.ts';
import { placeWordReply, recordAsk, settleAsk } from './brain.ts';
import type { AskOutcome, Question } from './broker.ts';
import { formatAskOutcome } from './format.ts';
import { maskPlaceWords } from './guard.ts';
import { formatReport } from './report.ts';
import { hasQuestionForm, reportAskSchema, type ReportAskInput } from './report-protocol.ts';
import {
  MIN_REMAINING_MS,
  elapsedMs,
  errorReply,
  remainingMs,
  roundOver,
  type SessionState,
  type ToolReply,
} from './state.ts';

/**
 * Brain tools of the report protocol (docs/evals/detective-spike-3.md, Part C): `briefing`
 * returns the eyes' scene report, and `ask` sends requests that name a topic. No images ever.
 */

const ROUND_OVER_TEXT = 'Раунд окончен: новые вызовы не принимаются.';
/** One `briefing` call waits this long for the report; the brain may call it again. */
export const BRIEFING_WAIT_MS = 40_000;

function waitForReport(s: SessionState): Promise<void> {
  const waitMs = Math.min(
    s.opts.briefingWaitMs ?? BRIEFING_WAIT_MS,
    remainingMs(s) - (s.opts.minRemainingMs ?? MIN_REMAINING_MS),
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

const secondsLeft = (s: SessionState): number => Math.max(0, Math.round(remainingMs(s) / 1000));

export async function handleBriefing(s: SessionState): Promise<ToolReply> {
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  if (s.report === null && s.eyesDownAtMs === null) await waitForReport(s);
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  if (s.report === null) {
    if (s.eyesDownAtMs !== null) {
      return errorReply(
        'Отчёта нет: процесс глаз завершился. Немедленно вызови final_guess с лучшей догадкой.',
      );
    }
    if (remainingMs(s) <= 2 * (s.opts.minRemainingMs ?? MIN_REMAINING_MS)) {
      return errorReply(
        `Отчёт не готов, осталось ${secondsLeft(s)} с. Немедленно вызови final_guess с лучшей догадкой.`,
      );
    }
    return { text: `Отчёт ещё не готов. Осталось ${secondsLeft(s)} с. Вызови briefing снова.` };
  }
  s.briefingAtMs ??= elapsedMs(s);
  return {
    text: [
      'Отчёт напарника о сцене (текст в «…» переписан со снимков дословно; […] — слово, скрытое сервером):',
      formatReport(s.report.masked),
      `Осталось времени: ${secondsLeft(s)} с.`,
    ].join('\n'),
  };
}

const requestText = (q: Question): string =>
  q.kind === 'describe' ? q.topic : q.kind === 'text' ? q.target : '';

/** A request that asks a question or names a place is refused and not counted. */
function guardRequests(s: SessionState, requests: readonly Question[]): ToolReply | null {
  for (const q of requests) {
    const text = requestText(q);
    if (hasQuestionForm(text)) {
      s.formRejections += 1;
      return errorReply(
        `[GEO_DETECTIVE_QUESTION_FORM] Запрос не отправлен: «${text}» — это вопрос. Назови тему, на которую посмотреть, без «?» и без «ли», например «люди на улице: одежда, чем заняты»: напарник сам опишет, что там видно. Отклонённый запрос не засчитан.`,
      );
    }
    const word = s.guard.findPlaceWord(text);
    if (word !== null) return placeWordReply(s, text, word);
  }
  return null;
}

/** Every ask owes `finding` and `current_guess`: the brain has read the report by then. */
function journalCorrection(s: SessionState, input: ReportAskInput): ToolReply | null {
  const missing = [
    ...(input.finding ? [] : ['finding']),
    ...(input.current_guess ? [] : ['current_guess']),
  ];
  const key = `ask:${s.asks.length + 1}`;
  if (missing.length === 0 || s.correctionsUsed.has(key)) return null;
  s.correctionsUsed.add(key);
  s.corrections.push({ role: 'brain', tool: 'ask', reason: missing.join(',') });
  const source = s.asks.length === 0 ? 'отчёта' : 'ответов на предыдущий запрос';
  return errorReply(
    `[GEO_BOT_JOURNAL_FIELD_MISSING] ask: не хватает полей: ${missing.join(', ')}. В finding напиши, что нового ты узнал из ${source} и что это меняет; в current_guess — твою лучшую точку. Запрос не отправлен. Исправление одно на шаг: повтори вызов с этими полями.`,
  );
}

/** The outcome as the brain reads it: place words in the eyes' own words are masked. */
function maskOutcome(s: SessionState, outcome: AskOutcome): AskOutcome {
  const items = outcome.items.map((item) => {
    if (item.question.kind !== 'describe' || item.status !== 'answered' || item.value === null) {
      return item;
    }
    const res = maskPlaceWords(s.guard, item.value);
    s.maskedInAnswers.push(...res.masked);
    return { ...item, value: res.text };
  });
  return { ...outcome, items };
}

export async function handleReportAsk(s: SessionState, args: unknown): Promise<ToolReply> {
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  if (s.briefingAtMs === null) {
    return errorReply('Сначала вызови briefing: без отчёта напарника запрос не отправится.');
  }
  const parsed = reportAskSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const requests: Question[] = parsed.data.requests;
  const blocked = guardRequests(s, requests) ?? journalCorrection(s, parsed.data);
  if (blocked) return blocked;
  const record = recordAsk(s, { ...parsed.data, questions: requests }, true);
  if (parsed.data.control === true) record.control = true;
  const outcome = await settleAsk(s, requests);
  if (!('requestId' in outcome)) return outcome;
  record.outcome = outcome;
  const text = formatAskOutcome(s.opts.catalog, maskOutcome(s, outcome), remainingMs(s) / 1000);
  if (outcome.settledBy === 'eyes_down') {
    return errorReply(`${text}\nГлаза больше не отвечают. Немедленно вызови final_guess.`);
  }
  return { text };
}
