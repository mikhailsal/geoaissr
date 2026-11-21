import { formatToolZodError, parseGuessInput } from '../../shared/bot-tools.ts';
import { BrokerBusyError, type AskOutcome, type Question } from './broker.ts';
import { duplicateOption } from './choice.ts';
import { formatAskOutcome } from './format.ts';
import { labelOutcome } from './labels.ts';
import { buildBrainSchemas, type AskInput } from './protocol.ts';
import {
  ASK_TIMEOUT_MS,
  MIN_REMAINING_MS,
  elapsedMs,
  errorReply,
  remainingMs,
  roundOver,
  type AskRecord,
  type SessionState,
  type ToolReply,
} from './state.ts';

/** Brain tools: `ask` (blocking, through the broker) and `final_guess`. No images ever. */

const ROUND_OVER_TEXT = 'Раунд окончен: новые вызовы не принимаются.';

/** The brain-written texts of one question that the eyes will read. */
function questionTexts(q: Question): string[] {
  if (q.kind === 'text') return [q.target];
  if (q.kind === 'choice') return [q.question, ...q.options];
  return [];
}

function placeWordReply(s: SessionState, text: string, word: string): ToolReply {
  s.guardRejections.push(word);
  return errorReply(
    `[GEO_DETECTIVE_PLACE_WORD] Вопрос не отправлен: в тексте «${text}» есть название места или народа («${word}»). Правило: глазам нельзя подсказывать место. Перефразируй без названий мест и народов (названия письменностей можно: «грузинское письмо»), например «самая крупная вывеска». Отклонённый запрос не засчитывается в лимит 5 вопросов.`,
  );
}

function guardQuestions(s: SessionState, questions: readonly Question[]): ToolReply | null {
  for (const q of questions) {
    for (const text of questionTexts(q)) {
      const word = s.guard.findPlaceWord(text);
      if (word !== null) return placeWordReply(s, text, word);
    }
    const dup = q.kind === 'choice' ? duplicateOption(q) : null;
    if (dup !== null) {
      return errorReply(
        `Вопрос «${q.kind === 'choice' ? q.question : ''}» не отправлен: вариант «${dup}» повторяется. Варианты должны различаться. Запрос не засчитан.`,
      );
    }
  }
  return null;
}

/** From the second ask on, `finding` and `current_guess` are due; one correction per ask. */
function journalCorrection(s: SessionState, input: AskInput): ToolReply | null {
  if (s.asks.length === 0) return null;
  const missing = [
    ...(input.finding ? [] : ['finding']),
    ...(input.current_guess ? [] : ['current_guess']),
  ];
  const key = `ask:${s.asks.length + 1}`;
  if (missing.length === 0 || s.correctionsUsed.has(key)) return null;
  s.correctionsUsed.add(key);
  s.corrections.push({ role: 'brain', tool: 'ask', reason: missing.join(',') });
  return errorReply(
    `[GEO_BOT_JOURNAL_FIELD_MISSING] ask: не хватает полей: ${missing.join(', ')}. В finding напиши, что показали ответы на предыдущий запрос и что это меняет; в current_guess — твою лучшую точку. Запрос не отправлен. Исправление одно на шаг: повтори вызов с этими полями.`,
  );
}

function recordAsk(s: SessionState, input: AskInput): AskRecord {
  const due = s.asks.length > 0;
  const record: AskRecord = {
    index: s.asks.length + 1,
    tMs: elapsedMs(s),
    hypothesis: input.hypothesis,
    questions: input.questions,
    finding: input.finding ?? null,
    findingState: !due ? 'not_due' : input.finding ? 'recorded' : 'missing',
    currentGuess: input.current_guess ?? null,
    outcome: null,
  };
  s.asks.push(record);
  if (input.current_guess) {
    s.checkpoints.push({ ...input.current_guess, tMs: record.tMs });
  }
  return record;
}

async function settleAsk(s: SessionState, questions: Question[]): Promise<AskOutcome | ToolReply> {
  const waitMs = Math.min(
    s.opts.askTimeoutMs ?? ASK_TIMEOUT_MS,
    remainingMs(s) - (s.opts.minRemainingMs ?? MIN_REMAINING_MS),
  );
  if (waitMs <= 0) {
    return errorReply(
      'Осталось меньше 10 с: запрос не отправлен. Немедленно вызови final_guess с лучшей точкой.',
    );
  }
  if (s.opts.answerSource === 'labels') return labelOutcome(s.opts.sample, questions);
  const busy = errorReply('Предыдущий запрос ещё не закрыт: дождись его ответа.');
  if (s.broker.hasPending()) return busy;
  s.askDeadlineAt = s.now() + waitMs;
  try {
    return await s.broker.ask(questions, waitMs);
  } catch (err) {
    if (err instanceof BrokerBusyError) return busy;
    throw err;
  } finally {
    s.askDeadlineAt = null;
  }
}

export async function handleAsk(s: SessionState, args: unknown): Promise<ToolReply> {
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  const parsed = buildBrainSchemas(s.opts.catalog, s.opts.protocol).ask.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const blocked = guardQuestions(s, parsed.data.questions) ?? journalCorrection(s, parsed.data);
  if (blocked) return blocked;
  const record = recordAsk(s, parsed.data);
  const outcome = await settleAsk(s, parsed.data.questions);
  if (!('requestId' in outcome)) return outcome;
  record.outcome = outcome;
  const text = formatAskOutcome(s.opts.catalog, outcome, remainingMs(s) / 1000);
  if (outcome.settledBy === 'eyes_down') {
    return errorReply(`${text}\nГлаза больше не отвечают. Немедленно вызови final_guess.`);
  }
  return { text };
}

export function handleFinalGuess(s: SessionState, args: unknown): ToolReply {
  if (roundOver(s)) return errorReply(ROUND_OVER_TEXT);
  const guess = parseGuessInput(args);
  if (!guess) {
    return errorReply('final_guess: нужны числовые lat и lng. Догадка не записана.');
  }
  const missing = [...(guess.summary ? [] : ['summary']), ...(guess.finding ? [] : ['finding'])];
  if (missing.length > 0 && !s.correctionsUsed.has('final')) {
    s.correctionsUsed.add('final');
    s.corrections.push({ role: 'brain', tool: 'final_guess', reason: missing.join(',') });
    s.checkpoints.push({ lat: guess.lat, lng: guess.lng, tMs: elapsedMs(s) });
    return errorReply(
      `[GEO_BOT_JOURNAL_FIELD_MISSING] final_guess: не хватает полей: ${missing.join(', ')}. Точка сохранена как промежуточная. Повтори final_guess с этими полями.`,
    );
  }
  s.final = {
    lat: guess.lat,
    lng: guess.lng,
    tMs: elapsedMs(s),
    summary: guess.summary ?? null,
    finding: guess.finding ?? null,
  };
  s.broker.close();
  for (const listener of s.finalListeners.splice(0)) listener();
  return { text: 'Догадка принята. Раунд для тебя окончен.' };
}
