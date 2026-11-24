import type { BotJournal, JournalReportLine, JournalRequest } from '$shared/bot-journal';
import type { BotAccounting } from '$shared/bot-results';
import { REPORT_SECTIONS } from '../../../shared/detective-report';
import { formatNumberRu } from '../i18n/format';
import { RU } from '../i18n/ru';

/** Texts of the Detective play style on the result card: the report and the brain–eyes exchange. */

export const BRAIN_TAG = 'МОЗГ';
export const EYES_TAG = 'ГЛАЗА';
export const REPORT_TITLE = 'Отчёт глаз';
export const CONTROL_TAG = 'контрольная проверка';
/** Said once on the card: the frames in the steps were seen by the eyes, not by the narrator. */
export const BRAIN_BLIND_NOTE = 'Мозг не видел кадров — только ответы глаз';

const CONFIDENCE_LABELS: Record<NonNullable<BotJournal['confidence']>, string> = {
  country: 'уверен в стране',
  region: 'уверен в регионе',
  guess: 'догадка',
};

const ABSTAIN_LABELS: Record<string, string> = {
  not_visible: 'не видно',
  unreadable: 'неразборчиво',
  no_road: 'проехать не удалось',
};

/** «Уверенность: уверен в стране»: how sure the brain said it was in its final answer. */
export function confidenceLine(confidence: BotJournal['confidence']): string | null {
  return confidence ? `Уверенность: ${CONFIDENCE_LABELS[confidence]}` : null;
}

/** What the brain asked for, as one line. */
export function requestLine(request: JournalRequest): string {
  if (request.kind === 'text') return `Прочитать: ${request.text}`;
  if (request.kind === 'drive') {
    const metres = Math.round(request.distanceM ?? 0);
    const heading = Math.round(request.heading ?? 0);
    return `Проехать ${metres} м на ${heading}° и описать: ${request.text}`;
  }
  return request.text;
}

export interface AnswerLine {
  text: string;
  /** «уверенно · кадр 5»; null when the eyes gave no answer. */
  meta: string | null;
  /** False when the line is a status («не видно», «глаза не ответили»), not the eyes' words. */
  answered: boolean;
}

function answerMeta(request: JournalRequest): string | null {
  const parts = [
    ...(request.confidence ? [request.confidence === 'sure' ? 'уверенно' : 'неуверенно'] : []),
    ...(request.frame !== undefined ? [`кадр ${request.frame}`] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** What the eyes answered, or why there is no answer. */
export function answerLine(request: JournalRequest): AnswerLine {
  const status = (text: string): AnswerLine => ({ text, meta: null, answered: false });
  if (request.status === 'answered') {
    return { text: request.value ?? '', meta: answerMeta(request), answered: true };
  }
  if (request.status === 'abstained') {
    return status(ABSTAIN_LABELS[request.value ?? ''] ?? 'ответа нет');
  }
  if (request.status === 'timeout') return status('глаза не ответили');
  if (request.status === 'eyes_down') return status('глаза отключились');
  return status('раунд закончился раньше ответа');
}

export interface ReportGroup {
  id: string;
  title: string;
  lines: JournalReportLine[];
}

/** The report grouped by section, in the fixed section order; empty sections are left out. */
export function reportGroups(lines: readonly JournalReportLine[]): ReportGroup[] {
  return REPORT_SECTIONS.map(({ id, ru }) => ({
    id,
    title: ru,
    lines: lines.filter((line) => line.section === id),
  })).filter((group) => group.lines.length > 0);
}

/**
 * «Мозг: 3 140 · Глаза: 4 580»: the tokens of each process of a Detective. The models are named
 * only when the two processes ran on different ones. Null for a bot that played Intuit.
 */
export function roleTokensLine(
  accounting: Pick<BotAccounting, 'roleUsage' | 'roleModels'>,
): string | null {
  const { roleUsage, roleModels } = accounting;
  if (!roleUsage) return null;
  const named = roleModels && roleModels.brain !== roleModels.eyes ? roleModels : undefined;
  const part = (role: 'brain' | 'eyes', label: string): string => {
    const usage = roleUsage[role];
    const model = named ? ` (${named[role]})` : '';
    return `${label}${model}: ${usage ? formatNumberRu(usage.totalTokens) : 'н/д'}`;
  };
  return `${part('brain', RU.playStyle.brain)} · ${part('eyes', RU.playStyle.eyes)}`;
}
