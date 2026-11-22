import { expect, test } from 'bun:test';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import { leg, ORIGIN, roadService, START } from '../../test/fixtures/road.ts';
import type { EngineEvent } from '../engine/types.ts';
import type { BotImageService, RenderedBotImage } from '../images/bot-image-service.ts';
import { createFakeLocationService } from '../location.ts';
import { createMoveTracker } from './move.ts';
import { buildRoundHandlers, effectiveRemainingSec } from './runner-handlers.ts';
import type { RunnerCtx } from './runner-types.ts';

// protects=bots read the engine's shortened round end; fails_when=runner keeps using the slot budget after all humans confirmed; no_claim=model reaction to the nudge.
test('effectiveRemainingSec uses the earlier of slot budget end and engine round end', () => {
  const base = { budgetSec: 90, startedAt: 10_000 };
  expect(effectiveRemainingSec({ ...base, roundDeadlineAt: null, now: 40_000 })).toBe(60);
  // All humans confirmed: the engine moved the round end to 50 s.
  expect(effectiveRemainingSec({ ...base, roundDeadlineAt: 50_000, now: 40_000 })).toBe(10);
  // An engine end later than the slot budget does not extend the bot.
  expect(effectiveRemainingSec({ ...base, roundDeadlineAt: 500_000, now: 40_000 })).toBe(60);
  expect(effectiveRemainingSec({ ...base, roundDeadlineAt: 50_000, now: 60_000 })).toBe(0);
});

const SLOT: BotSlotConfig = {
  id: 'b1',
  name: 'b1',
  color: 'p-3',
  enabled: true,
  harness: 'claude',
  model: 'haiku',
  effort: 'low',
  moveLimit: 4,
  imageSize: 256,
  budgetSec: 60,
  difficultyPreset: 'amateur',
  personalityPreset: 'neutral',
  personalityText: '',
};

const FRAME: RenderedBotImage = {
  jpeg: Buffer.from('frame'),
  thumbId: 't1',
  thumbUrl: '/thumb/t1',
  fullId: 'f1',
  fullUrl: '/thumb/f1',
  label: 'кадр',
};

/**
 * Round handlers over a real walk on a road running east, with an image service that records the
 * heading of every move frame. `onLookup` runs before each metadata lookup, with its number.
 */
async function handlersOnEastRoad(onLookup: (n: number) => void = () => {}) {
  const frameHeadings: number[] = [];
  const events: EngineEvent[] = [];
  const imageService = {
    getMoveView: (opts: { heading: number }) => {
      frameHeadings.push(opts.heading);
      return Promise.resolve(FRAME);
    },
  } as unknown as BotImageService;
  const ctx = {
    imageService,
    dispatch: (event: EngineEvent) => events.push(event),
  } as unknown as RunnerCtx;
  const target = await createFakeLocationService().prepareRoundLocation({
    region: 'world',
    excludeCountryIds: [],
  });
  const road = roadService(leg('e', ORIGIN, 90, 3000, 10)).service;
  let lookups = 0;
  const tracker = createMoveTracker({
    initial: { ...START, fakeSceneIndex: 0 },
    moveEnabled: true,
    fakeMode: false,
    locationService: {
      ...road,
      queryMetadata: (lat, lng, radius) => {
        lookups += 1;
        onLookup(lookups);
        return road.queryMetadata(lat, lng, radius);
      },
    },
  });
  const handlers = buildRoundHandlers(
    ctx,
    { matchId: 'm1', gen: 1, roundNumber: 1, target, slot: SLOT, moveEnabled: true },
    {
      tracker,
      waitObserveRelease: () => Promise.resolve(),
      getTurnsUsed: () => 0,
      getStartedAt: () => 0,
      onSubmittedGuess: () => {},
    },
  );
  return { handlers, frameHeadings, events, tracker };
}

// Value: protects=the frame of a long move looks along the road the walk ended on, and a short step keeps the heading the bot asked for; fails_when=the handler sends the asked heading to the image service after a long move, or the road bearing after a short step; why_new=fake mode reports the asked heading as the travel bearing, so the runner test through the bot API cannot tell the two apart; seam=none; no_claim=what a real Street View frame shows.
test('a long move frames the road it took and a short step keeps the asked heading', async () => {
  const { handlers, frameHeadings, events } = await handlersOnEastRoad();
  const signal = new AbortController().signal;
  // The road runs east (90 degrees); the bot asks for 70, which is 20 degrees off the road.
  const short = await handlers.executeMove({ heading: 70 }, signal);
  expect(short.isError).not.toBe(true);
  expect(frameHeadings[0]).toBe(70);

  const far = await handlers.executeMove({ heading: 70, distance_m: 500 }, signal);
  expect(far.isError).not.toBe(true);
  expect(far.text).toContain('Дальний ход');
  expect(Math.abs((frameHeadings[1] ?? 0) - 90)).toBeLessThan(5);

  const thumbs = events
    .filter((event) => event.type === 'bot_thumb_added')
    .map((event) => event.thumb);
  expect(thumbs[0]?.params).toEqual({ heading: 70, step: 1 });
  expect(Math.abs((thumbs[1]?.params?.heading ?? 0) - 90)).toBeLessThan(5);
  expect(thumbs[1]?.params?.distanceM).toBeGreaterThanOrEqual(490);
});

// Value: protects=no frame is requested for a round that ended during a move (with a real key the frame is the billed request) and the bot stays where it was; fails_when=the handler asks the image service for a frame after the round ended, whether the walk noticed the end or its last lookup finished first; why_new=the other handler test never ends the round; seam=metadata lookup; no_claim=what the image service bills.
test('a round that ends during a move requests no frame and moves nobody', async () => {
  // Mid-walk: the round ends at the third lookup of a 1500 m move.
  const midWalk = new AbortController();
  const far = await handlersOnEastRoad((n) => {
    if (n === 3) midWalk.abort();
  });
  const farReply = await far.handlers.executeMove(
    { heading: 90, distance_m: 1500 },
    midWalk.signal,
  );
  expect(farReply).toEqual({ text: 'Раунд уже завершён.', isError: true });
  expect(far.frameHeadings).toHaveLength(0);
  expect(far.tracker.getPosition().panoId).toBe(START.panoId);

  // During the only lookup of a short step: the walk itself finishes as usual.
  const lastLookup = new AbortController();
  const near = await handlersOnEastRoad(() => {
    lastLookup.abort();
  });
  const nearReply = await near.handlers.executeMove({ heading: 90 }, lastLookup.signal);
  expect(nearReply).toEqual({ text: 'Раунд уже завершён.', isError: true });
  expect(near.frameHeadings).toHaveLength(0);
  expect(near.tracker.getPosition().steps).toBe(0);
  expect(near.events).toHaveLength(0);
});
