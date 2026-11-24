import type { JournalReportLine, JournalRequest } from '../../../shared/bot-journal.ts';
import { REPORT_SECTIONS } from '../../../shared/detective-report.ts';
import {
  ANSWER_VALUE_MAX_LEN,
  isAbstain,
  type AbstainValue,
  type EyesConfidence,
} from '../../../shared/detective-tools.ts';
import type { AskOutcome, BrokerRequest, Question, SettledItem } from './broker.ts';
import { frameNote, secondsLeft, turnsLeft, type SessionState } from './state.ts';

/** Russian texts the two roles read. Kept apart from the session logic so both stay small. */

const ABSTAIN_RU: Record<AbstainValue, string> = {
  not_visible: 'не видно',
  unreadable: 'неразборчиво',
  no_road: 'проехать не удалось',
};

const CONFIDENCE_RU: Record<EyesConfidence, string> = { sure: 'уверенно', unsure: 'неуверенно' };

/** The words of a request the eyes will read. */
export function requestText(q: Question): string {
  return q.kind === 'text' ? q.target : q.topic;
}

function requestTitle(q: Question): string {
  if (q.kind === 'text') return `Текст «${q.target}»`;
  if (q.kind === 'drive') {
    return `Проезд ${Math.round(q.distance_m)} м на ${Math.round(q.heading)}°, «${q.topic}»`;
  }
  return `«${q.topic}»`;
}

/** « (неуверенно, кадр 5)»: the confidence mark and the frame of an answer. */
function answerTail(s: SessionState, item: SettledItem): string {
  const parts = [
    ...(item.confidence ? [CONFIDENCE_RU[item.confidence]] : []),
    ...(item.frame === null ? [] : [frameNote(s, item.frame)]),
  ];
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

function itemLine(s: SessionState, item: SettledItem): string {
  const title = `${item.n}. ${requestTitle(item.question)}`;
  if (item.status === 'timeout') return `${title}: напарник не ответил вовремя`;
  if (item.status === 'eyes_down') return `${title}: нет ответа, процесс напарника завершился`;
  const value = item.value ?? '';
  if (item.status === 'abstained') {
    return `${title}: ${isAbstain(value) ? ABSTAIN_RU[value] : value}`;
  }
  const shown = item.question.kind === 'text' ? `"${value}"` : value;
  return `${title}: ${shown}${answerTail(s, item)}`;
}

/** The lines every reply to the brain ends with: the clock and the eyes' paid actions. */
export function brainStatusLines(s: SessionState): string[] {
  const left = secondsLeft(s);
  return [
    `Осталось времени: ${left} с. Платных ходов у напарника: ${turnsLeft(s)}.`,
    ...(left <= 15 ? ['Немедленно вызови final_guess с выводом по последним ответам.'] : []),
  ];
}

export function formatAskOutcome(s: SessionState, outcome: AskOutcome): string {
  return [
    `Ответы на запрос ${outcome.requestId}:`,
    ...outcome.items.map((item) => itemLine(s, item)),
    ...brainStatusLines(s),
  ].join('\n');
}

/** The report as the brain reads it: every section named, every line with its frame. */
export function formatReport(s: SessionState, lines: readonly JournalReportLine[]): string {
  const out: string[] = [];
  for (const { id, ru } of REPORT_SECTIONS) {
    out.push(`${ru}:`);
    const section = lines.filter((line) => line.section === id);
    if (section.length === 0) out.push('- ничего не отмечено');
    for (const line of section) out.push(`- ${line.text} (${frameNote(s, line.frame)})`);
  }
  return out.join('\n');
}

function requestForEyes(q: Question, n: number): string {
  if (q.kind === 'text') {
    return `${n}. Перепиши дословно текст: «${q.target}». value — текст как написано (любой алфавит); или not_visible / unreadable.`;
  }
  if (q.kind === 'drive') {
    const call = `move(heading=${Math.round(q.heading)}, distance_m=${Math.round(q.distance_m)})`;
    return `${n}. Проедь по дороге: ${call}, затем опиши по новым кадрам: «${q.topic}». Если в эту сторону дороги нет, попробуй соседний азимут вдоль дороги; если проехать не удалось совсем — value "no_road".`;
  }
  return `${n}. Опиши своими словами, что видно: «${q.topic}». value — короткое описание (до ${ANSWER_VALUE_MAX_LEN} знаков); или not_visible, если этого на кадрах нет, / unreadable.`;
}

function framesLine(s: SessionState): string {
  if (s.frames.length === 0) return 'Кадров пока нет: сначала вызови observe.';
  const parts = s.frames.map((f) => `${f.n} (${f.action} ${Math.round(f.heading)}°)`);
  return `Выданные кадры: ${parts.join(', ')}.`;
}

export function formatRequestForEyes(s: SessionState, request: BrokerRequest): string {
  const actions = s.opts.moveEnabled ? 'look и move' : 'look';
  // The real time left: near the end of a round the brain waits less than the usual limit.
  const seconds = Math.max(1, Math.round(request.leftMs / 1000));
  return [
    `Запрос ${request.id}. Ответь через answer(request_id="${request.id}", answers=[{n, value, confidence, frame}]).`,
    ...request.questions.map((q, idx) => requestForEyes(q, idx + 1)),
    framesLine(s),
    `Осталось платных ходов (${actions}): ${turnsLeft(s)}. Мелкое сначала приблизь, потом отвечай; на запрос до ${seconds} с.`,
  ].join('\n');
}

/** The requests of an exchange as the journal stores them; `items` is null while the eyes work. */
export function journalRequests(
  questions: readonly Question[],
  items: readonly SettledItem[] | null,
): JournalRequest[] {
  return questions.map((q, idx) => {
    const item = items?.[idx];
    return {
      n: idx + 1,
      kind: q.kind,
      text: requestText(q),
      ...(q.kind === 'drive' ? { heading: q.heading, distanceM: q.distance_m } : {}),
      status: item?.status ?? 'pending',
      ...(item?.value ? { value: item.value } : {}),
      ...(item?.confidence ? { confidence: item.confidence } : {}),
      ...(item && item.frame !== null ? { frame: item.frame } : {}),
    };
  });
}
