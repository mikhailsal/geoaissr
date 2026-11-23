import type { BotTurnThumbView } from '../../../shared/bot-results.ts';
import { formatToolZodError } from '../../../shared/bot-tools.ts';
import {
  PRE_REPORT_ACTIONS,
  detectiveAnswerSchema,
  eyesLookSchema,
  eyesMoveSchema,
  isAbstain,
} from '../../../shared/detective-tools.ts';
import { flattenReport, sceneReportSchema } from '../../../shared/detective-report.ts';
import { haversineDistanceKm } from '../../../shared/score.ts';
import type { RenderedBotImage } from '../../images/bot-image-service.ts';
import { headingToCardinalRu, normalizeHeadingDeg } from '../../images/label.ts';
import { bearingDeg } from '../road-walk.ts';
import { moveReplyText } from '../runner-handlers.ts';
import type { AnswerItem, BrokerRequest } from './broker.ts';
import { formatRequestForEyes } from './format.ts';
import { maskPlaceWords } from './guard.ts';
import {
  NEXT_REQUEST_WAIT_MS,
  errorReply,
  roundOver,
  turnsLeft,
  wakeReportWaiters,
  type FrameRecord,
  type SessionState,
  type ToolReply,
} from './state.ts';

/** Eyes tools: camera actions with frame numbers, the scene report and the request loop. */

const ROUND_OVER_TEXT = 'Раунд окончен. Больше ничего не вызывай и заверши работу.';
const OBSERVE_FIRST_TEXT = 'Сначала вызови observe: без стартовых кадров остальное не работает.';
const REPORT_FIRST_TEXT =
  'Сначала сдай отчёт о сцене: вызови report. Напарник ждёт его и без него не может начать.';
/** A frame closer to the start than this counts as taken at the start. */
const AT_START_M = 15;

/** Paid actions the eyes may still spend before the report. */
function preReportLeft(s: SessionState): number {
  return Math.min(PRE_REPORT_ACTIONS, s.opts.moveLimit) - s.turnsUsed;
}

function imageBlocks(imgs: readonly RenderedBotImage[], firstN: number): ToolReply['images'] {
  return imgs.map((img, i) => ({
    name: `frame-${firstN + i}.jpg`,
    base64: img.jpeg.toString('base64'),
    mimeType: 'image/jpeg',
  }));
}

/** Records a delivered frame under the next number and reports it for the journal. */
function addFrame(
  s: SessionState,
  action: FrameRecord['action'],
  view: RenderedBotImage,
  params: NonNullable<BotTurnThumbView['params']>,
): number {
  const n = s.frames.length + 1;
  const pos = s.opts.tracker.getPosition();
  const metres = haversineDistanceKm(s.opts.target, pos) * 1000;
  const away = metres >= AT_START_M;
  s.frames.push({
    n,
    action,
    heading: params.heading,
    fromStartM: away ? metres : 0,
    fromStartDir: away ? headingToCardinalRu(bearingDeg(s.opts.target, pos)) : null,
  });
  s.opts.sink.frame({
    // Frames taken while the eyes answer belong to the exchange they answer.
    turn: s.asks,
    action,
    n,
    label: view.label,
    thumbUrl: view.thumbUrl,
    fullUrl: view.fullUrl,
    params: { ...params, ...(away ? { fromStartM: Math.round(metres) } : {}) },
  });
  return n;
}

function afterObserveText(s: SessionState): string {
  const left = preReportLeft(s);
  if (left <= 0) return 'Теперь сдай отчёт: report.';
  const move = s.opts.moveEnabled ? ' или один проезд move, если вокруг пусто' : '';
  return `Теперь охота за текстом: приближения look (fov 20–40) туда, где может быть текст${move}; платных ходов до отчёта: ${left}. Затем report.`;
}

export async function handleObserve(s: SessionState): Promise<ToolReply> {
  await s.opts.waitStart(s.abort.signal);
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  try {
    const views = await s.opts.imageService.getObserveViews({
      target: s.opts.target,
      size: s.opts.imageSize,
    });
    if (roundOver(s)) return { text: ROUND_OVER_TEXT };
    if (s.frames.length === 0) {
      views.forEach((view, idx) => addFrame(s, 'observe', view, { heading: idx * 90 }));
    }
    const list = views.map((v, i) => `${i + 1} — ${v.label}`).join('; ');
    return { text: `Кадры 1–4: ${list}. ${afterObserveText(s)}`, images: imageBlocks(views, 1) };
  } catch (err) {
    return errorReply(err instanceof Error ? err.message : String(err));
  }
}

/** Why a paid action cannot run now; null when it may. */
function paidActionProblem(s: SessionState): ToolReply | null {
  if (s.frames.length === 0) return errorReply(OBSERVE_FIRST_TEXT);
  if (turnsLeft(s) === 0) {
    return errorReply(
      `Платные ходы кончились (${s.opts.moveLimit} из ${s.opts.moveLimit}). Ход не списан: отвечай по имеющимся кадрам или not_visible.`,
    );
  }
  // The brain cannot start without the report, so the hunt before it is short.
  if (s.report === null && preReportLeft(s) <= 0) {
    return errorReply(
      `До отчёта можно сделать не больше ${PRE_REPORT_ACTIONS} платных ходов. Ход не списан: сдай отчёт (report), остальные ходы — по просьбам напарника.`,
    );
  }
  return null;
}

function chargeTurn(s: SessionState): void {
  s.turnsUsed += 1;
  s.opts.sink.turns(s.turnsUsed);
}

export async function handleLook(s: SessionState, args: unknown): Promise<ToolReply> {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  const parsed = eyesLookSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const problem = paidActionProblem(s);
  if (problem) return problem;
  const { heading, pitch } = parsed.data;
  const fov = parsed.data.fov ?? 90;
  const pos = s.opts.tracker.getPosition();
  try {
    const view = await s.opts.imageService.getLookView({
      panoId: pos.panoId,
      lat: pos.lat,
      lng: pos.lng,
      heading,
      pitch,
      fov,
      size: s.opts.imageSize,
      fakeSceneIndex: pos.fakeSceneIndex,
    });
    if (roundOver(s)) return { text: ROUND_OVER_TEXT };
    chargeTurn(s);
    const n = addFrame(s, 'look', view, {
      heading: normalizeHeadingDeg(heading),
      pitch: Math.round(pitch),
      fov: Math.round(fov),
    });
    return { text: `Кадр ${n}: ${view.label}`, images: imageBlocks([view], n) };
  } catch (err) {
    return errorReply(err instanceof Error ? err.message : String(err));
  }
}

export async function handleMove(s: SessionState, args: unknown): Promise<ToolReply> {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  if (!s.opts.moveEnabled) {
    return errorReply('Движение выключено в этой партии. Ход не списан: пользуйся look.');
  }
  const parsed = eyesMoveSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const problem = paidActionProblem(s);
  if (problem) return problem;
  const tracker = s.opts.tracker;
  const prev = tracker.getPosition();
  const distanceM = parsed.data.distance_m;
  const far = distanceM !== undefined;
  try {
    const res = await tracker.stepToward(parsed.data.heading, {
      signal: s.abort.signal,
      ...(far ? { distanceM } : {}),
    });
    if (!res.ok) return errorReply(res.message ?? 'В эту сторону проехать нельзя. Ход не списан.');
    // A short step keeps looking where the eyes asked; a long move looks along the road it took.
    const heading = far ? (res.headingDeg ?? parsed.data.heading) : parsed.data.heading;
    const view = roundOver(s)
      ? null
      : await s.opts.imageService.getMoveView({
          panoId: res.position.panoId,
          lat: res.position.lat,
          lng: res.position.lng,
          heading,
          step: res.position.steps,
          size: s.opts.imageSize,
          fakeSceneIndex: res.position.fakeSceneIndex,
        });
    if (view === null || roundOver(s)) {
      tracker.restorePosition(prev);
      return { text: ROUND_OVER_TEXT };
    }
    chargeTurn(s);
    s.movesDone += 1;
    const n = addFrame(s, 'move', view, {
      heading: normalizeHeadingDeg(heading),
      step: res.position.steps,
      ...(far && res.travelledM !== undefined ? { distanceM: res.travelledM } : {}),
    });
    const text = `Кадр ${n}. ${moveReplyText(view.label, res, far)} Следующие look снимаются отсюда.`;
    return { text, images: imageBlocks([view], n) };
  } catch (err) {
    tracker.restorePosition(prev);
    return errorReply(err instanceof Error ? err.message : String(err));
  }
}

export function handleReport(s: SessionState, args: unknown): ToolReply {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  if (s.frames.length === 0) return errorReply(OBSERVE_FIRST_TEXT);
  if (s.report !== null) return { text: 'Отчёт уже принят. Вызови next_request.' };
  const parsed = sceneReportSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const lines = flattenReport(parsed.data);
  if (lines.length === 0) {
    return errorReply('Отчёт пуст: опиши, что видно на кадрах, хотя бы в одном разделе.');
  }
  // A wrong frame number does not reject the report: rewriting it would cost the brain its time.
  // The eyes never name a place: place words outside «…» are masked before the brain reads them.
  s.report = lines.map((line) => ({ ...line, text: maskPlaceWords(s.guard, line.text).text }));
  s.opts.sink.step(0, { report: s.report });
  wakeReportWaiters(s);
  return { text: 'Отчёт принят и передан напарнику. Вызови next_request.' };
}

export async function handleNextRequest(s: SessionState): Promise<ToolReply> {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  if (s.report === null) return errorReply(REPORT_FIRST_TEXT);
  const request = await s.broker.nextRequest(s.opts.nextRequestWaitMs ?? NEXT_REQUEST_WAIT_MS);
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  if (!request) return { text: 'Запросов пока нет. Вызови next_request снова.' };
  if (!s.movesAtDelivery.has(request.id)) s.movesAtDelivery.set(request.id, s.movesDone);
  return { text: formatRequestForEyes(s, request) };
}

/** Problems of one answer item against the request and the issued frames; empty when valid. */
function itemProblems(s: SessionState, request: BrokerRequest, item: AnswerItem): string[] {
  const q = request.questions[item.n - 1];
  if (!q) return [`просьбы ${item.n} нет в запросе`];
  if (item.value === 'no_road') {
    return q.kind === 'drive' ? [] : [`просьба ${item.n}: no_road годится только для проезда`];
  }
  if (isAbstain(item.value)) return [];
  const problems: string[] = [];
  if (item.frame === null) problems.push(`просьба ${item.n}: укажи frame — номер кадра`);
  else if (!s.frames.some((f) => f.n === item.frame)) {
    problems.push(`просьба ${item.n}: кадра ${item.frame} не было`);
  }
  if (item.confidence === undefined) {
    problems.push(`просьба ${item.n}: укажи confidence — sure или unsure`);
  }
  const moved = s.movesDone > (s.movesAtDelivery.get(request.id) ?? s.movesDone);
  if (q.kind === 'drive' && !moved) {
    problems.push(
      `просьба ${item.n} — проезд: сначала вызови move, потом отвечай по новому кадру; если проехать не удалось — value "no_road"`,
    );
  }
  return problems;
}

export function handleAnswer(s: SessionState, args: unknown): ToolReply {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  const parsed = detectiveAnswerSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const items: AnswerItem[] = parsed.data.answers.map((a) => ({
    n: a.n,
    value: a.value,
    frame: a.frame ?? null,
    ...(a.confidence && !isAbstain(a.value) ? { confidence: a.confidence } : {}),
  }));
  const current = s.broker.current();
  if (current?.id === parsed.data.request_id) {
    const problems = items.flatMap((item) => itemProblems(s, current, item));
    if (problems.length > 0) {
      s.opts.sink.correction?.({ role: 'eyes', tool: 'answer', reason: problems.join('; ') });
      return errorReply(
        `Ответ не принят:\n- ${problems.join('\n- ')}\nИсправь и вызови answer снова.`,
      );
    }
  }
  const result = s.broker.answer(parsed.data.request_id, items);
  if (result === 'settled') return { text: 'Ответ принят. Вызови next_request.' };
  if (result === 'late') {
    return { text: 'Этот запрос уже закрыт (время вышло); ответ отброшен. Вызови next_request.' };
  }
  return errorReply('Нет такого запроса. Вызови next_request.');
}
