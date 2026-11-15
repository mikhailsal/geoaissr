import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { BotGuessData, EngineEvent, RoundTarget } from '../engine/types.ts';
import type { BotImageService } from '../images/bot-image-service.ts';
import type { ServerLogger } from '../log.ts';
import type { BotToolApiServer } from './api.ts';
import { cleanupBotHandle, type ActiveBotHandle } from './process.ts';
import { dispatchObserveThumbs, makeThumb } from './thumbs.ts';

function finishFakeBot(
  opts: { matchId: string; gen: number; roundNumber: number; slotId: string },
  slot: BotSlotConfig,
  target: RoundTarget,
  dispatch: (event: EngineEvent) => void,
): void {
  const offset = slot.harness === 'claude' ? 0.4 : slot.harness === 'codex' ? -0.6 : 0.9;
  const guess: BotGuessData = {
    lat: Math.max(-85, Math.min(85, target.lat + offset)),
    lng: target.lng + offset,
    explanation: `Вижу дорожную разметку и ландшафт, характерный для ${target.countryNameRu}.`,
    facts: 'Вижу дорожную разметку и местный ландшафт.',
    rejectedGuesses: [
      { guess: 'Другая климатическая зона', reason: 'Растительность не совпадает.' },
    ],
    conclusion: `Улики указывают на ${target.countryNameRu}.`,
    quip: slot.personalityPreset === 'braggart' ? 'Легчайшая точка!' : 'Проверяю ориентиры.',
  };
  dispatch({
    type: 'bot_guess_recorded',
    matchId: opts.matchId,
    gen: opts.gen,
    roundNumber: opts.roundNumber,
    botId: slot.id,
    guess,
  });
  dispatch({
    type: 'bot_finished',
    matchId: opts.matchId,
    gen: opts.gen,
    roundNumber: opts.roundNumber,
    botId: slot.id,
    aborted: false,
    reason: 'завершил ход',
  });
}

export async function runFakeBotSequence(opts: {
  ids: { matchId: string; gen: number; roundNumber: number; slotId: string };
  isStopped: () => boolean;
  slot: BotSlotConfig;
  target: RoundTarget;
  imageService: BotImageService;
  observePromise: Promise<void>;
  dispatch: (event: EngineEvent) => void;
  stepDelayMs: number;
}): Promise<void> {
  const { ids, isStopped, slot, target, observePromise, dispatch, stepDelayMs } = opts;
  await observePromise;
  if (isStopped()) return;

  const views = await opts.imageService.getObserveViews({ target, size: slot.imageSize });
  dispatchObserveThumbs(
    dispatch,
    { matchId: ids.matchId, gen: ids.gen, roundNumber: ids.roundNumber, botId: slot.id },
    0,
    views,
  );
  dispatch({
    type: 'bot_guess_recorded',
    ...ids,
    botId: slot.id,
    finalized: false,
    guess: {
      lat: Math.max(-85, Math.min(85, target.lat + 1.5)),
      lng: target.lng + 1.5,
      explanation: 'Предварительная оценка.',
      facts: 'Оцениваю ландшафт.',
    },
  });
  await new Promise((r) => setTimeout(r, stepDelayMs));
  if (isStopped()) return;

  const lookView = await opts.imageService.getLookView({
    panoId: target.panoId,
    lat: target.lat,
    lng: target.lng,
    heading: 90,
    pitch: 0,
    fov: 60,
    size: slot.imageSize,
    fakeSceneIndex: target.fakeSceneIndex,
  });
  dispatch({
    type: 'bot_turns_updated',
    matchId: ids.matchId,
    gen: ids.gen,
    roundNumber: ids.roundNumber,
    botId: slot.id,
    turnsUsed: 1,
  });
  dispatch({
    type: 'bot_thumb_added',
    matchId: ids.matchId,
    gen: ids.gen,
    roundNumber: ids.roundNumber,
    botId: slot.id,
    thumb: makeThumb(1, 'look', lookView, {
      params: { heading: 90, pitch: 0, fov: 60 },
      hypothesis: 'Приближаю дорожные детали, чтобы проверить регион.',
    }),
  });
  await new Promise((r) => setTimeout(r, stepDelayMs));
  if (!isStopped()) finishFakeBot(ids, slot, target, dispatch);
}

/** Run simulated fake bot sequence with failure fallback and handle cleanup. */
export function startMonitoredFakeBot(opts: {
  matchId: string;
  gen: number;
  roundNumber: number;
  slot: BotSlotConfig;
  target: RoundTarget;
  imageService: BotImageService;
  observePromise: Promise<void>;
  dispatch: (event: EngineEvent) => void;
  stepDelayMs: number;
  api: BotToolApiServer;
  activeHandles: Map<string, ActiveBotHandle>;
  handle: ActiveBotHandle;
  logger?: ServerLogger;
}): void {
  const { slot, handle, dispatch, matchId, gen, roundNumber } = opts;
  opts.logger?.registerSecrets([], [handle.token]);
  opts.logger?.log('harness_start', {
    slotId: slot.id,
    harness: slot.harness,
    roundNumber,
    mode: 'fake',
  });
  void runFakeBotSequence({
    ids: { matchId, gen, roundNumber, slotId: slot.id },
    isStopped: () => handle.stopped,
    slot,
    target: opts.target,
    imageService: opts.imageService,
    observePromise: opts.observePromise,
    dispatch,
    stepDelayMs: opts.stepDelayMs,
  })
    .catch((err: unknown) => {
      if (handle.stopped) return;
      const tail = (err instanceof Error ? err.message : String(err)).slice(-300);
      dispatch({
        type: 'bot_finished',
        matchId,
        gen,
        roundNumber,
        botId: slot.id,
        aborted: true,
        reason: 'сбой имитации',
        diagnosticsTail: tail,
      });
    })
    .finally(() => {
      opts.logger?.log('harness_end', {
        slotId: slot.id,
        harness: slot.harness,
        roundNumber,
        mode: 'fake',
        aborted: handle.stopped,
      });
      cleanupBotHandle(opts.api, opts.activeHandles, handle);
    });
}
