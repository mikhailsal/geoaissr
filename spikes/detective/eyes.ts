import type { RenderedBotImage } from '../../server/images/bot-image-service.ts';
import { normalizeHeadingDeg } from '../../server/images/label.ts';
import { formatToolZodError } from '../../shared/bot-tools.ts';
import type { AnswerItem, BrokerRequest } from './broker.ts';
import { allowedValues, findFeature, isAbstain } from './catalog.ts';
import { formatRequestForEyes } from './format.ts';
import { answerSchema, eyesLookSchema, type AnswerInput } from './protocol.ts';
import {
  NEXT_REQUEST_WAIT_MS,
  elapsedMs,
  errorReply,
  roundOver,
  type SessionState,
  type ToolReply,
} from './state.ts';

/** Eyes tools: camera actions with frame numbers, and the blocking request/answer pair. */

const ROUND_OVER_TEXT = 'Раунд окончен. Больше ничего не вызывай и заверши работу.';

function imageBlocks(imgs: RenderedBotImage[], firstN: number): ToolReply['images'] {
  return imgs.map((img, i) => ({
    name: `frame-${firstN + i}.jpg`,
    base64: img.jpeg.toString('base64'),
    mimeType: 'image/jpeg',
  }));
}

export async function handleObserve(s: SessionState): Promise<ToolReply> {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  const views = await s.opts.imageService.getObserveViews({
    target: s.opts.target,
    size: s.opts.imageSize,
  });
  if (s.frames.length === 0) {
    views.forEach((_v, idx) => {
      const heading = normalizeHeadingDeg((s.opts.sample.headingDeg ?? 0) + idx * 90);
      s.frames.push({ n: idx + 1, action: 'observe', heading, pitch: 0, fov: 90, tMs: 0 });
    });
  }
  return {
    text: `Кадры 1–4: ${views.map((v, i) => `${i + 1} — ${v.label}`).join('; ')}. Теперь вызови next_request.`,
    images: imageBlocks(views, 1),
  };
}

export async function handleLook(s: SessionState, args: unknown): Promise<ToolReply> {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  const parsed = eyesLookSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  if (s.turnsUsed >= s.opts.moveLimit) {
    return errorReply(
      `Платные ходы кончились (${s.opts.moveLimit} из ${s.opts.moveLimit}). Ход не списан: отвечай по имеющимся кадрам или not_visible.`,
    );
  }
  s.turnsUsed += 1;
  const { heading, pitch } = parsed.data;
  const fov = parsed.data.fov ?? 90;
  try {
    const view = await s.opts.imageService.getLookView({
      panoId: s.opts.target.panoId,
      lat: s.opts.target.lat,
      lng: s.opts.target.lng,
      heading,
      pitch,
      fov,
      size: s.opts.imageSize,
      fakeSceneIndex: s.opts.target.fakeSceneIndex,
    });
    const n = s.frames.length + 1;
    s.frames.push({
      n,
      action: 'look',
      heading: normalizeHeadingDeg(heading),
      pitch,
      fov,
      tMs: elapsedMs(s),
    });
    return { text: `Кадр ${n}: ${view.label}`, images: imageBlocks([view], n) };
  } catch (err) {
    return errorReply(err instanceof Error ? err.message : String(err));
  }
}

export async function handleNextRequest(s: SessionState): Promise<ToolReply> {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  const request = await s.broker.nextRequest(s.opts.nextRequestWaitMs ?? NEXT_REQUEST_WAIT_MS);
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  if (!request) return { text: 'Запросов пока нет. Вызови next_request снова.' };
  return {
    text: formatRequestForEyes(
      s.opts.catalog,
      request,
      s.frames,
      Math.max(0, s.opts.moveLimit - s.turnsUsed),
    ),
  };
}

/** Problems of one answer item against the request and the issued frames; empty when valid. */
function itemProblems(s: SessionState, request: BrokerRequest, item: AnswerItem): string[] {
  const q = request.questions[item.n - 1];
  if (!q) return [`вопроса ${item.n} нет в запросе`];
  const problems: string[] = [];
  if (q.kind === 'feature') {
    const feature = findFeature(s.opts.catalog, q.feature);
    if (feature && !allowedValues(feature).includes(item.value)) {
      problems.push(
        `вопрос ${item.n}: значение «${item.value}» не из списка (${allowedValues(feature).join(', ')})`,
      );
    }
  }
  if (!isAbstain(item.value)) {
    if (item.frame === null) problems.push(`вопрос ${item.n}: укажи frame — номер кадра`);
    else if (!s.frames.some((f) => f.n === item.frame)) {
      problems.push(`вопрос ${item.n}: кадра ${item.frame} не было`);
    }
  }
  return problems;
}

function toItems(input: AnswerInput): AnswerItem[] {
  return input.answers.map((a) => ({ n: a.n, value: a.value, frame: a.frame ?? null }));
}

export function handleAnswer(
  s: SessionState,
  args: unknown,
  current: BrokerRequest | null,
): ToolReply {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  const parsed = answerSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const items = toItems(parsed.data);
  const log = { requestId: parsed.data.request_id, tMs: elapsedMs(s) };
  if (current?.id === parsed.data.request_id) {
    const problems = items.flatMap((item) => itemProblems(s, current, item));
    if (problems.length > 0) {
      s.eyesAnswers.push({ ...log, result: 'invalid' });
      s.corrections.push({ role: 'eyes', tool: 'answer', reason: problems.join('; ') });
      return errorReply(
        `Ответ не принят:\n- ${problems.join('\n- ')}\nИсправь и вызови answer снова.`,
      );
    }
  }
  const result = s.broker.answer(parsed.data.request_id, items);
  s.eyesAnswers.push({ ...log, result });
  if (result === 'settled') return { text: 'Ответ принят. Вызови next_request.' };
  if (result === 'late') {
    return { text: 'Этот запрос уже закрыт (время вышло); ответ отброшен. Вызови next_request.' };
  }
  return errorReply('Нет такого запроса. Вызови next_request.');
}
