import type { AskOutcome, BrokerRequest, EyesConfidence, Question, SettledItem } from './broker.ts';
import {
  ABSTAIN_RU,
  allowedValues,
  findFeature,
  valueLabelRu,
  type CatalogFeature,
} from './catalog.ts';
import { NONE_OF_THESE, choiceLabelRu } from './choice.ts';

/** Russian texts the two roles read. Kept apart from the session logic so both stay small. */

export interface FrameRef {
  n: number;
  action: 'observe' | 'look';
  heading: number;
}

export function questionTitle(catalog: readonly CatalogFeature[], q: Question): string {
  if (q.kind === 'text') return `Текст «${q.target}»`;
  if (q.kind === 'choice') return `«${q.question}»`;
  if (q.kind === 'describe') return `«${q.topic}»`;
  const feature = findFeature(catalog, q.feature);
  return feature ? `${feature.ru} (${feature.id})` : q.feature;
}

const CONFIDENCE_RU: Record<EyesConfidence, string> = { sure: 'уверенно', unsure: 'неуверенно' };

/** « (неуверенно, кадр 5)»: the confidence mark of the report protocol and the frame. */
function answerTail(item: SettledItem): string {
  const parts = [
    ...(item.confidence ? [CONFIDENCE_RU[item.confidence]] : []),
    ...(item.frame === null ? [] : [`кадр ${item.frame}`]),
  ];
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

function itemLine(catalog: readonly CatalogFeature[], item: SettledItem): string {
  const title = questionTitle(catalog, item.question);
  const frame = item.frame === null ? '' : ` (кадр ${item.frame})`;
  switch (item.status) {
    case 'timeout':
      return `${item.n}. ${title}: глаза не ответили вовремя`;
    case 'eyes_down':
      return `${item.n}. ${title}: нет ответа, процесс глаз завершился`;
    case 'abstained':
      return `${item.n}. ${title}: ${ABSTAIN_RU[item.value === 'unreadable' ? 'unreadable' : 'not_visible']}${frame}`;
    case 'answered': {
      const value = item.value ?? '';
      if (item.question.kind === 'text') {
        return `${item.n}. ${title}: "${value}"${answerTail(item)}`;
      }
      if (item.question.kind === 'describe')
        return `${item.n}. ${title}: ${value}${answerTail(item)}`;
      if (item.question.kind === 'choice') {
        return `${item.n}. ${title}: ${choiceLabelRu(item.question, value)}${frame}`;
      }
      const feature = findFeature(catalog, item.question.feature);
      const label = feature ? valueLabelRu(feature, value) : value;
      return `${item.n}. ${title}: ${label}${frame}`;
    }
  }
}

export function formatAskOutcome(
  catalog: readonly CatalogFeature[],
  outcome: AskOutcome,
  remainingSec: number,
): string {
  const lines = [`Ответы на запрос ${outcome.requestId}:`];
  for (const item of outcome.items) lines.push(itemLine(catalog, item));
  lines.push(`Осталось времени: ${Math.max(0, Math.round(remainingSec))} с.`);
  if (remainingSec <= 15) {
    lines.push('Немедленно вызови final_guess с выводом по последним ответам.');
  }
  return lines.join('\n');
}

function questionForEyes(catalog: readonly CatalogFeature[], q: Question, n: number): string {
  if (q.kind === 'text') {
    return `${n}. Прочитай дословно текст: «${q.target}». value — текст как написано (любой алфавит); или not_visible / unreadable.`;
  }
  if (q.kind === 'describe') {
    return `${n}. Опиши своими словами, что видно: «${q.topic}». value — короткое описание (до 200 знаков); или not_visible, если этого на кадрах нет, / unreadable.`;
  }
  if (q.kind === 'choice') {
    const options = q.options.map((o, i) => `${i + 1} — ${o}`).join('; ');
    return `${n}. Вопрос: «${q.question}». Варианты: ${options}. value — номер варианта; или ${NONE_OF_THESE} (видно, но ни один не подходит) / not_visible / unreadable.`;
  }
  const feature = findFeature(catalog, q.feature);
  if (!feature) return `${n}. ${q.feature}`;
  const values = feature.values.map((v) => `${v.id} — ${v.ru}`).join('; ');
  const abstain = allowedValues(feature).filter((v) => !feature.values.some((x) => x.id === v));
  const tail = abstain.length > 0 ? `; или ${abstain.join(' / ')}` : '';
  return `${n}. Признак «${feature.ru}» (${feature.id}). Значения: ${values}${tail}.`;
}

function framesLine(frames: readonly FrameRef[]): string {
  if (frames.length === 0) return 'Кадров пока нет: сначала вызови observe.';
  const parts = frames.map((f) => `${f.n} (${f.action} ${Math.round(f.heading)}°)`);
  return `Выданные кадры: ${parts.join(', ')}.`;
}

export function formatRequestForEyes(
  catalog: readonly CatalogFeature[],
  request: BrokerRequest,
  frames: readonly FrameRef[],
  opts: { turnsLeft: number; requireZoom: boolean; confidence?: boolean },
): string {
  const fields = opts.confidence ? '{n, value, confidence, frame}' : '{n, value, frame}';
  const zoom =
    opts.requireZoom && opts.turnsLeft > 0
      ? [
          'Перед not_visible или unreadable сначала сделай look (приближение): без него отказ не примут.',
        ]
      : [];
  return [
    `Запрос ${request.id}. Ответь через answer(request_id="${request.id}", answers=[${fields}]).`,
    ...request.questions.map((q, idx) => questionForEyes(catalog, q, idx + 1)),
    framesLine(frames),
    `Осталось платных ходов look: ${opts.turnsLeft}. Отвечай быстро: у мозга мало времени.`,
    ...zoom,
  ].join('\n');
}
