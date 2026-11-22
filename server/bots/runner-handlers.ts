import { getRegionDiagonalKm } from '../../shared/regions.ts';
import type { RenderedBotImage } from '../images/bot-image-service.ts';
import { normalizeHeadingDeg } from '../images/label.ts';
import type { MoveResult, MoveTracker } from './move.ts';
import type { BotSessionHandlers, ToolResponsePayload } from './queue.ts';
import { REGION_LABELS_RU, type RoundBotParams, type RunnerCtx } from './runner-types.ts';
import { dispatchObserveThumbs, makeThumb } from './thumbs.ts';

function toImageBlocks(
  imgs: RenderedBotImage[],
): Array<{ name: string; base64: string; mimeType: string }> {
  return imgs.map((img, i) => ({
    name: `frame-${Date.now()}-${i + 1}.jpg`,
    base64: img.jpeg.toString('base64'),
    mimeType: 'image/jpeg',
  }));
}

async function runLookTool(
  ctx: RunnerCtx,
  params: RoundBotParams,
  tracker: MoveTracker,
  turnNum: number,
  args: { heading: number; pitch: number; fov: number; hypothesis?: string },
  signal: AbortSignal,
): Promise<ToolResponsePayload> {
  const pos = tracker.getPosition();
  try {
    const view = await ctx.imageService.getLookView({
      panoId: pos.panoId,
      lat: pos.lat,
      lng: pos.lng,
      heading: args.heading,
      pitch: args.pitch,
      fov: args.fov,
      size: params.slot.imageSize,
      fakeSceneIndex: pos.fakeSceneIndex,
    });
    if (signal.aborted) return { text: 'Раунд уже завершён.', isError: true };
    ctx.dispatch({
      type: 'bot_thumb_added',
      matchId: params.matchId,
      gen: params.gen,
      roundNumber: params.roundNumber,
      botId: params.slot.id,
      thumb: makeThumb(turnNum, 'look', view, {
        params: {
          heading: normalizeHeadingDeg(args.heading),
          pitch: Math.round(args.pitch),
          fov: Math.round(args.fov),
        },
        ...(args.hypothesis ? { hypothesis: args.hypothesis } : {}),
      }),
    });
    return { text: view.label, images: toImageBlocks([view]) };
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}

/** Reply of a successful move: a short step keeps its old text, a long move reports the road. */
export function moveReplyText(label: string, res: MoveResult, far: boolean): string {
  if (!far) return `Перемещение выполнено (${label}).`;
  const base = `Дальний ход: пройдено около ${res.travelledM ?? 0} м по дороге, кадр смотрит по ходу движения (${label}).`;
  if (res.stop === 'road_end') return `${base} Дальше в эту сторону панорам нет.`;
  if (res.stop === 'search_limit') {
    return `${base} Сервер остановился раньше заданного расстояния: дорога слишком извилистая.`;
  }
  return base;
}

async function runMoveTool(
  ctx: RunnerCtx,
  params: RoundBotParams,
  tracker: MoveTracker,
  turnNum: number,
  args: { heading: number; distance_m?: number; hypothesis?: string },
  signal: AbortSignal,
): Promise<ToolResponsePayload> {
  const prevPos = tracker.getPosition();
  const far = args.distance_m !== undefined;
  try {
    const res = await tracker.stepToward(args.heading, {
      signal,
      ...(args.distance_m !== undefined ? { distanceM: args.distance_m } : {}),
    });
    if (!res.ok) return { text: res.message ?? 'Тупик', isError: true };
    // A short step keeps looking where the bot asked; a long move looks along the road it took.
    const viewHeading = far ? (res.headingDeg ?? args.heading) : args.heading;
    try {
      const view = await ctx.imageService.getMoveView({
        panoId: res.position.panoId,
        lat: res.position.lat,
        lng: res.position.lng,
        heading: viewHeading,
        step: res.position.steps,
        size: params.slot.imageSize,
        fakeSceneIndex: res.position.fakeSceneIndex,
      });
      if (signal.aborted) throw new Error('Раунд уже завершён.');
      ctx.dispatch({
        type: 'bot_thumb_added',
        matchId: params.matchId,
        gen: params.gen,
        roundNumber: params.roundNumber,
        botId: params.slot.id,
        thumb: makeThumb(turnNum, 'move', view, {
          params: {
            heading: normalizeHeadingDeg(viewHeading),
            step: res.position.steps,
            ...(far && res.travelledM !== undefined ? { distanceM: res.travelledM } : {}),
          },
          ...(args.hypothesis ? { hypothesis: args.hypothesis } : {}),
        }),
      });
      return { text: moveReplyText(view.label, res, far), images: toImageBlocks([view]) };
    } catch (err) {
      tracker.restorePosition(prevPos);
      throw err;
    }
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}

/**
 * Seconds left for the bot: the earlier of its slot budget end and the engine's round end. The
 * engine moves the round end earlier when every human confirmed, so a bot must not keep reading
 * its full slot budget then.
 */
export function effectiveRemainingSec(opts: {
  budgetSec: number;
  startedAt: number;
  roundDeadlineAt: number | null;
  now: number;
}): number {
  const slotEnd = opts.startedAt + opts.budgetSec * 1000;
  const end = opts.roundDeadlineAt === null ? slotEnd : Math.min(slotEnd, opts.roundDeadlineAt);
  return Math.max(0, (end - opts.now) / 1000);
}

export function buildRoundHandlers(
  ctx: RunnerCtx,
  params: RoundBotParams,
  deps: {
    tracker: MoveTracker;
    waitObserveRelease: (signal: AbortSignal) => Promise<void>;
    getTurnsUsed: () => number;
    getStartedAt: () => number;
    getRoundDeadlineAt?: () => number | null;
    onSubmittedGuess: () => void;
  },
): BotSessionHandlers {
  const { matchId, gen, roundNumber, target, slot } = params;
  return {
    waitObserveRelease: deps.waitObserveRelease,
    async executeObserve(): Promise<ToolResponsePayload> {
      try {
        const views = await ctx.imageService.getObserveViews({ target, size: slot.imageSize });
        // The start frames are always step 0, even when a paid call came first.
        dispatchObserveThumbs(
          ctx.dispatch,
          { matchId, gen, roundNumber, botId: slot.id },
          0,
          views,
        );
        return {
          text: `Стартовые 4 кадра (С, В, Ю, З). Регион: ${REGION_LABELS_RU[target.region]}, макс. масштаб D ≈ ${Math.round(getRegionDiagonalKm(target.region))} км.`,
          images: toImageBlocks(views),
        };
      } catch (err) {
        return { text: err instanceof Error ? err.message : String(err), isError: true };
      }
    },
    executeLook: (args, signal) =>
      runLookTool(ctx, params, deps.tracker, deps.getTurnsUsed() + 1, args, signal),
    executeMove: (args, signal) =>
      runMoveTool(ctx, params, deps.tracker, deps.getTurnsUsed() + 1, args, signal),
    onGuess(guess, finalized) {
      deps.onSubmittedGuess();
      ctx.dispatch({
        type: 'bot_guess_recorded',
        matchId,
        gen,
        roundNumber,
        botId: slot.id,
        guess,
        finalized,
      });
    },
    onFinding: ({ turn, ...rest }) => {
      ctx.dispatch({
        type: 'bot_finding',
        matchId,
        gen,
        roundNumber,
        botId: slot.id,
        turn,
        ...rest,
      });
    },
    onTurnsChanged: (turnsUsed) => {
      ctx.dispatch({
        type: 'bot_turns_updated',
        matchId,
        gen,
        roundNumber,
        botId: slot.id,
        turnsUsed,
      });
    },
    getRemainingTimeSec: () =>
      effectiveRemainingSec({
        budgetSec: slot.budgetSec,
        startedAt: deps.getStartedAt(),
        roundDeadlineAt: deps.getRoundDeadlineAt?.() ?? null,
        now: Date.now(),
      }),
  };
}
