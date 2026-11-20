import { getRegionDiagonalKm } from '../../shared/regions.ts';
import type { RenderedBotImage } from '../images/bot-image-service.ts';
import { normalizeHeadingDeg } from '../images/label.ts';
import type { MoveTracker } from './move.ts';
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

async function runMoveTool(
  ctx: RunnerCtx,
  params: RoundBotParams,
  tracker: MoveTracker,
  turnNum: number,
  args: { heading: number; hypothesis?: string },
  signal: AbortSignal,
): Promise<ToolResponsePayload> {
  const prevPos = tracker.getPosition();
  try {
    const res = await tracker.stepToward(args.heading);
    if (!res.ok) return { text: res.message ?? 'Тупик', isError: true };
    try {
      const view = await ctx.imageService.getMoveView({
        panoId: res.position.panoId,
        lat: res.position.lat,
        lng: res.position.lng,
        heading: args.heading,
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
          params: { heading: normalizeHeadingDeg(args.heading), step: res.position.steps },
          ...(args.hypothesis ? { hypothesis: args.hypothesis } : {}),
        }),
      });
      return { text: `Перемещение выполнено (${view.label}).`, images: toImageBlocks([view]) };
    } catch (err) {
      tracker.restorePosition(prevPos);
      throw err;
    }
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}

export function buildRoundHandlers(
  ctx: RunnerCtx,
  params: RoundBotParams,
  deps: {
    tracker: MoveTracker;
    waitObserveRelease: (signal: AbortSignal) => Promise<void>;
    getTurnsUsed: () => number;
    getStartedAt: () => number;
    onSubmittedGuess: () => void;
  },
): BotSessionHandlers {
  const { matchId, gen, roundNumber, target, slot } = params;
  return {
    waitObserveRelease: deps.waitObserveRelease,
    async executeObserve(): Promise<ToolResponsePayload> {
      try {
        const views = await ctx.imageService.getObserveViews({ target, size: slot.imageSize });
        dispatchObserveThumbs(
          ctx.dispatch,
          { matchId, gen, roundNumber, botId: slot.id },
          deps.getTurnsUsed(),
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
      Math.max(0, slot.budgetSec - (Date.now() - deps.getStartedAt()) / 1000),
  };
}
