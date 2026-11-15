import type { BotTurnThumbView } from '../../shared/protocol.ts';
import type { EngineEvent } from '../engine/types.ts';
import type { RenderedBotImage } from '../images/bot-image-service.ts';

export function makeThumb(
  turn: number,
  action: 'observe' | 'look' | 'move',
  rendered: RenderedBotImage,
  details?: Pick<BotTurnThumbView, 'params' | 'hypothesis'>,
): BotTurnThumbView {
  return {
    turn,
    action,
    label: rendered.label,
    thumbUrl: rendered.thumbUrl,
    fullUrl: rendered.fullUrl,
    ...details,
  };
}

/** The bot sees all four start frames, so the "why?" card shows all four too. */
export function dispatchObserveThumbs(
  dispatch: (event: EngineEvent) => void,
  ids: { matchId: string; gen: number; roundNumber: number; botId: string },
  turn: number,
  views: readonly RenderedBotImage[],
): void {
  for (const view of views) {
    dispatch({ type: 'bot_thumb_added', ...ids, thumb: makeThumb(turn, 'observe', view) });
  }
}
