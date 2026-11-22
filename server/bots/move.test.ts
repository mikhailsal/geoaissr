import { expect, test } from 'bun:test';
import { haversineDistanceKm } from '../../shared/score.ts';
import { leg, ORIGIN, roadService, START } from '../../test/fixtures/road.ts';
import { createFakeLocationService } from '../location.ts';
import { createMoveTracker } from './move.ts';
import { moveReplyText } from './runner-handlers.ts';

const initial = { ...START, fakeSceneIndex: 0 };
const metresFromStart = (p: { lat: number; lng: number }): number =>
  haversineDistanceKm(ORIGIN, p) * 1000;

// Value: protects=a long move is one paid step that lands far down the road and reports what it covered; fails_when=the tracker counts every hop as a step or drops the distance; seam=metadata lookup; no_claim=real road shapes.
test('a long move is one step that reports the road it covered', async () => {
  const road = roadService(leg('e', ORIGIN, 90, 3000, 10));
  const tracker = createMoveTracker({
    initial,
    moveEnabled: true,
    fakeMode: false,
    locationService: road.service,
  });
  const res = await tracker.stepToward(80, { distanceM: 600 });
  expect(res.ok).toBe(true);
  expect(res.stop).toBe('reached');
  expect(res.position.steps).toBe(1);
  expect(res.travelledM).toBeGreaterThanOrEqual(590);
  expect(res.travelledM).toBeLessThanOrEqual(680);
  expect(metresFromStart(res.position)).toBeGreaterThanOrEqual(590);
  // The requested heading was 10 degrees off; the reported one is the road's.
  expect(Math.abs((res.headingDeg ?? 0) - 90)).toBeLessThan(5);
  expect(tracker.getPosition()).toEqual(res.position);
});

// Value: protects=a refused move leaves the bot where it was and is not charged; fails_when=the position changes or the call reports success with no road ahead; seam=metadata lookup; no_claim=none.
test('a move with no road ahead fails and keeps the position', async () => {
  const road = roadService(leg('e', ORIGIN, 90, 300, 10));
  const tracker = createMoveTracker({
    initial,
    moveEnabled: true,
    fakeMode: false,
    locationService: road.service,
  });
  const before = tracker.getPosition();
  const res = await tracker.stepToward(270, { distanceM: 500 });
  expect(res.ok).toBe(false);
  expect(res.message).toContain('Ход не списан');
  expect(tracker.getPosition()).toEqual(before);
});

test('fake mode moves by the asked distance, or one short step without it', async () => {
  const make = () =>
    createMoveTracker({
      initial,
      moveEnabled: true,
      fakeMode: true,
      locationService: createFakeLocationService(),
    });
  const far = await make().stepToward(90, { distanceM: 400 });
  expect(far.ok).toBe(true);
  expect(far.travelledM).toBe(400);
  expect(Math.round(metresFromStart(far.position))).toBe(400);
  const near = await make().stepToward(90);
  expect(Math.round(metresFromStart(near.position))).toBe(25);
  expect(near.position.steps).toBe(1);
});

test('a move is refused when the match has movement off', async () => {
  const tracker = createMoveTracker({
    initial,
    moveEnabled: false,
    fakeMode: true,
    locationService: createFakeLocationService(),
  });
  const res = await tracker.stepToward(90, { distanceM: 400 });
  expect(res.ok).toBe(false);
  expect(tracker.getPosition().steps).toBe(0);
});

// Value: protects=the bot is told how far a long move went and when it stopped short; fails_when=a short step changes its reply or an early stop is reported as a full move; seam=none; no_claim=whether a model acts on the text.
test('the move reply tells a short step from a long move and names an early stop', () => {
  const position = { ...initial, steps: 1 };
  const base = { ok: true, position, travelledM: 430, headingDeg: 40 };
  expect(moveReplyText('Шаг 1: 90° В', { ok: true, position }, false)).toBe(
    'Перемещение выполнено (Шаг 1: 90° В).',
  );
  const reached = moveReplyText('Шаг 1: 40° СВ', { ...base, stop: 'reached' }, true);
  expect(reached).toContain('около 430 м');
  expect(reached).not.toContain('Дальше');
  expect(moveReplyText('x', { ...base, stop: 'road_end' }, true)).toContain(
    'Дальше в эту сторону панорам нет',
  );
  expect(moveReplyText('x', { ...base, stop: 'search_limit' }, true)).toContain(
    'остановился раньше',
  );
  expect(moveReplyText('x', { ...base, stop: 'lookup_failed' }, true)).toContain(
    'запрос следующей панорамы не удался',
  );
});

// Value: protects=a round that ended during the walk moves nobody, and a search that ran out of time before the first hop is not reported as a missing road; fails_when=an aborted walk is committed as a successful move, or a stalled search tells the bot there is no road that way; why_new=the other tracker tests never end a round or stall a lookup; seam=metadata lookup and the clock; no_claim=how often real lookups stall.
test('an ended round moves nobody and a stalled search is not called a missing road', async () => {
  const road = roadService(leg('e', ORIGIN, 90, 3000, 10));
  const round = new AbortController();
  let lookups = 0;
  const tracker = createMoveTracker({
    initial,
    moveEnabled: true,
    fakeMode: false,
    locationService: {
      ...road.service,
      queryMetadata: (lat, lng, radius) => {
        lookups += 1;
        if (lookups === 3) round.abort();
        return road.service.queryMetadata(lat, lng, radius);
      },
    },
  });
  const before = tracker.getPosition();
  const ended = await tracker.stepToward(90, { distanceM: 1500, signal: round.signal });
  expect(ended).toEqual({ ok: false, position: before, message: 'Раунд уже завершён.' });
  expect(tracker.getPosition()).toEqual(before);

  let clock = 0;
  const stalled = createMoveTracker({
    initial,
    moveEnabled: true,
    fakeMode: false,
    locationService: {
      ...road.service,
      // Every lookup misses and takes five seconds of the walk's clock.
      queryMetadata: () => {
        clock += 5_000;
        return Promise.resolve({ status: 'ZERO_RESULTS' });
      },
    },
    now: () => clock,
  });
  const res = await stalled.stepToward(90, { distanceM: 500 });
  expect(res.ok).toBe(false);
  expect(res.message).toContain('не успел');
  expect(res.message).toContain('Ход не списан');
  expect(res.message).not.toContain('не найдена');
});
