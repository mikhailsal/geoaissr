import type { Shift } from '../../shared/bot-journal.ts';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { BotGuessData, EngineEvent, RoundTarget } from '../engine/types.ts';
import type { BotImageService } from '../images/bot-image-service.ts';
import type { ServerLogger } from '../log.ts';
import type { BotToolApiServer } from './api.ts';
import { cleanupBotHandle, type ActiveBotHandle } from './process.ts';
import { dispatchObserveThumbs, makeThumb } from './thumbs.ts';

interface FakeIds {
  matchId: string;
  gen: number;
  roundNumber: number;
  slotId: string;
}

type Dispatch = (event: EngineEvent) => void;

function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

/** A finding for step `turn`, as the queue would attach it to the previous step. */
function dispatchFinding(
  dispatch: Dispatch,
  ids: FakeIds,
  turn: number,
  finding: string,
  extra: { shifts?: Shift[]; point?: { lat: number; lng: number } } = {},
): void {
  dispatch({
    type: 'bot_finding',
    matchId: ids.matchId,
    gen: ids.gen,
    roundNumber: ids.roundNumber,
    botId: ids.slotId,
    turn,
    findingState: 'recorded',
    finding,
    ...(extra.shifts ? { shifts: extra.shifts } : {}),
    ...(extra.point ? { currentGuess: extra.point } : {}),
  });
  if (extra.point) {
    dispatch({
      type: 'bot_guess_recorded',
      matchId: ids.matchId,
      gen: ids.gen,
      roundNumber: ids.roundNumber,
      botId: ids.slotId,
      finalized: false,
      guess: { ...extra.point, explanation: '' },
    });
  }
}

function finishFakeBot(
  ids: FakeIds,
  slot: BotSlotConfig,
  target: RoundTarget,
  dispatch: Dispatch,
): void {
  const summary = `Я увидел дорожную разметку и ландшафт, характерный для ${target.countryNameRu}, проверил соседние версии и остановился на этой точке.`;
  const offset = slot.harness === 'claude' ? 0.4 : slot.harness === 'codex' ? -0.6 : 0.9;
  const guess: BotGuessData = {
    lat: clampLat(target.lat + offset),
    lng: target.lng + offset,
    explanation: summary,
    summary,
    quip: slot.personalityPreset === 'braggart' ? 'Легчайшая точка!' : 'Проверяю ориентиры.',
  };
  dispatchFinding(
    dispatch,
    ids,
    2,
    `Шаг по дороге показал знаки и разметку, которые подтверждают версию: ${target.countryNameRu}.`,
    {
      shifts: [
        {
          version: target.countryNameRu,
          effect: 'stronger',
          because: 'Знаки совпали с разметкой.',
        },
      ],
    },
  );
  dispatch({
    type: 'bot_guess_recorded',
    matchId: ids.matchId,
    gen: ids.gen,
    roundNumber: ids.roundNumber,
    botId: slot.id,
    guess,
  });
  dispatch({
    type: 'bot_finished',
    matchId: ids.matchId,
    gen: ids.gen,
    roundNumber: ids.roundNumber,
    botId: slot.id,
    aborted: false,
    reason: 'завершил ход',
  });
}

interface FakeStep {
  turn: number;
  kind: 'look' | 'move';
  previous: { finding: string; shifts: Shift[]; point: { lat: number; lng: number } };
  hypothesis: string;
  params: NonNullable<Parameters<typeof makeThumb>[3]>['params'];
  render: () => ReturnType<BotImageService['getLookView']>;
}

/** One paid step: the previous step's finding and point first, then the frame, as the queue does. */
async function fakeStep(
  base: {
    ids: FakeIds;
    slot: BotSlotConfig;
    dispatch: Dispatch;
    thumbIds: { matchId: string; gen: number; roundNumber: number };
  },
  step: FakeStep,
): Promise<void> {
  const { ids, slot, dispatch, thumbIds } = base;
  dispatchFinding(dispatch, ids, step.turn - 1, step.previous.finding, {
    shifts: step.previous.shifts,
    point: step.previous.point,
  });
  const view = await step.render();
  dispatch({ type: 'bot_turns_updated', ...thumbIds, botId: slot.id, turnsUsed: step.turn });
  dispatch({
    type: 'bot_thumb_added',
    ...thumbIds,
    botId: slot.id,
    thumb: makeThumb(step.turn, step.kind, view, {
      params: step.params,
      hypothesis: step.hypothesis,
    }),
  });
}

const pause = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

/**
 * Simulates a full journal without a CLI: observe, a look and a move, each with a reason and
 * a finding, one shift of every effect, a current point that moves, and a final summary.
 */
export async function runFakeBotSequence(opts: {
  ids: FakeIds;
  isStopped: () => boolean;
  slot: BotSlotConfig;
  target: RoundTarget;
  imageService: BotImageService;
  observePromise: Promise<void>;
  dispatch: Dispatch;
  stepDelayMs: number;
}): Promise<void> {
  const { ids, isStopped, slot, target, observePromise, dispatch, stepDelayMs } = opts;
  await observePromise;
  if (isStopped()) return;

  const thumbIds = { matchId: ids.matchId, gen: ids.gen, roundNumber: ids.roundNumber };
  const views = await opts.imageService.getObserveViews({ target, size: slot.imageSize });
  dispatchObserveThumbs(dispatch, { ...thumbIds, botId: slot.id }, 0, views);
  await pause(stepDelayMs);
  if (isStopped()) return;

  const base = { ids, slot, dispatch, thumbIds };
  const near = (d: number) => ({ lat: clampLat(target.lat + d), lng: target.lng + d });
  const frame = { panoId: target.panoId, lat: target.lat, lng: target.lng };
  const common = { ...frame, size: slot.imageSize, fakeSceneIndex: target.fakeSceneIndex };

  // Step 1: look. Its call carries the finding about the observe frames and the first point.
  await fakeStep(base, {
    turn: 1,
    kind: 'look',
    previous: {
      finding:
        'На стартовых кадрах видны дорога и местный ландшафт; климат не похож на соседние зоны.',
      shifts: [
        {
          version: 'Другая климатическая зона',
          effect: 'weaker',
          because: 'Растительность не та.',
        },
      ],
      point: near(1.5),
    },
    hypothesis:
      'Приближаю дорожные детали: если разметка местная, версия остаётся, иначе её надо ослабить.',
    params: { heading: 90, pitch: 0, fov: 60 },
    render: () => opts.imageService.getLookView({ ...common, heading: 90, pitch: 0, fov: 60 }),
  });
  await pause(stepDelayMs);
  if (isStopped()) return;

  // Step 2: move. Its call carries the finding about the look and a point that has moved.
  await fakeStep(base, {
    turn: 2,
    kind: 'move',
    previous: {
      finding:
        'Приближение показало разметку и знаки местного образца; соседняя страна не подходит.',
      shifts: [
        { version: 'Соседняя страна', effect: 'excluded', because: 'Знаки другого образца.' },
      ],
      point: near(0.5),
    },
    hypothesis: 'Иду вдоль дороги: новый знак подтвердит или опровергнет текущую версию.',
    params: { heading: 0, step: 1 },
    render: () => opts.imageService.getMoveView({ ...common, heading: 0, step: 1 }),
  });
  await pause(stepDelayMs);
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
