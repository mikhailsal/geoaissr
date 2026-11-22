import { expect, test } from 'bun:test';
import { haversineDistanceKm } from '../../shared/score.ts';
import { leg, ORIGIN, roadService, START } from '../../test/fixtures/road.ts';
import {
  bearingDeg,
  destinationPoint,
  MAX_WALK_MS,
  MAX_WALK_PROBES,
  turnDeg,
  walkRoad,
  type PanoPoint,
} from './road-walk.ts';

const metresFromStart = (p: { lat: number; lng: number }): number =>
  haversineDistanceKm(ORIGIN, p) * 1000;

function walk(panos: readonly PanoPoint[], headingDeg: number, distanceM: number | null) {
  const road = roadService(panos);
  return walkRoad({
    start: START,
    headingDeg,
    distanceM,
    queryMetadata: road.service.queryMetadata,
  }).then((result) => ({ result, calls: road.calls }));
}

test('bearing and turn helpers agree with the compass', () => {
  const east = destinationPoint(ORIGIN.lat, ORIGIN.lng, 90, 0.5);
  expect(bearingDeg(ORIGIN, east)).toBeCloseTo(90, 0);
  expect(turnDeg(350, 10)).toBe(20);
  expect(turnDeg(10, 350)).toBe(20);
  expect(turnDeg(90, 270)).toBe(180);
});

// Value: protects=a move without a distance stays the one short step it always was; fails_when=the walk keeps hopping or makes more than one lookup on a dense road; seam=metadata lookup; no_claim=how far apart real panoramas are.
test('a short step makes one hop to the next panorama', async () => {
  const { result, calls } = await walk(leg('e', ORIGIN, 90, 300, 10), 90, null);
  expect(result.stop).toBe('reached');
  expect(result.hops).toBe(1);
  expect(calls).toHaveLength(1);
  expect(metresFromStart(result.end)).toBeGreaterThan(5);
  expect(metresFromStart(result.end)).toBeLessThan(40);
});

// Value: protects=a long move covers the asked distance in a handful of lookups; fails_when=the walk falls back to short hops on a straight road or overshoots by more than one long reach; seam=metadata lookup; no_claim=lookup latency.
test('a long move on a straight road covers the distance in few lookups', async () => {
  const { result, calls } = await walk(leg('e', ORIGIN, 90, 3000, 10), 90, 1000);
  expect(result.stop).toBe('reached');
  expect(result.travelledM).toBeGreaterThanOrEqual(990);
  expect(result.travelledM).toBeLessThanOrEqual(1080);
  expect(metresFromStart(result.end)).toBeGreaterThanOrEqual(990);
  expect(calls.length).toBeLessThanOrEqual(12);
  expect(turnDeg(result.headingDeg, 90)).toBeLessThan(5);
});

// Value: protects=the walk follows a road that turns instead of leaving it; fails_when=the next probe keeps the requested heading and misses the road after the bend; seam=metadata lookup; no_claim=behaviour at real junctions.
test('a long move follows a bend in the road', async () => {
  const east = leg('e', ORIGIN, 90, 300, 10);
  const corner = east.at(-1) ?? START;
  // A quarter circle of radius 60 m turning north, then a straight leg north.
  const centre = destinationPoint(corner.lat, corner.lng, 0, 0.06);
  const arc: PanoPoint[] = [];
  for (let deg = 10; deg <= 90; deg += 10) {
    const p = destinationPoint(centre.lat, centre.lng, 180 - deg, 0.06);
    arc.push({ panoId: `a${deg}`, lat: p.lat, lng: p.lng });
  }
  const north = leg('n', arc.at(-1) ?? corner, 0, 600, 10);
  const { result } = await walk([...east, ...arc, ...north], 90, 700);
  expect(result.stop).toBe('reached');
  expect(result.end.panoId.startsWith('n')).toBe(true);
  expect(turnDeg(result.headingDeg, 0)).toBeLessThan(15);
});

// Value: protects=a long move stops where the road ends and says so; fails_when=the walk turns around at a dead end or reports the full distance; seam=metadata lookup; no_claim=none.
test('a long move stops at a dead end without turning back', async () => {
  const road = leg('e', ORIGIN, 90, 200, 10);
  const { result } = await walk(road, 90, 1000);
  expect(result.stop).toBe('road_end');
  expect(result.end.panoId).toBe(road.at(-1)?.panoId ?? '');
  expect(result.travelledM).toBeGreaterThan(180);
  expect(result.travelledM).toBeLessThan(215);
});

// Value: protects=a long move crosses a stretch with no panoramas near its end instead of reporting that the road ended; fails_when=only the short probes are tried once little distance is left; seam=metadata lookup; no_claim=how wide real coverage gaps are.
test('a long move crosses a gap in the coverage near the end of its distance', async () => {
  const before = leg('e', ORIGIN, 90, 200, 10);
  const gapEnd = destinationPoint(ORIGIN.lat, ORIGIN.lng, 90, 0.32);
  const after = [{ panoId: 'g0', ...gapEnd }, ...leg('g', gapEnd, 90, 700, 10)];
  const { result } = await walk([...before, ...after], 90, 280);
  expect(result.stop).toBe('reached');
  expect(result.end.panoId.startsWith('g')).toBe(true);
  expect(metresFromStart(result.end)).toBeLessThan(450);
});

// Value: protects=a move away from the only road is refused instead of stepping backwards; fails_when=the nearest panorama behind the bot is accepted as "ahead"; seam=metadata lookup; no_claim=none.
test('no panorama in the asked direction means no hop', async () => {
  const { result } = await walk(leg('e', ORIGIN, 90, 300, 10), 270, null);
  expect(result.hops).toBe(0);
  expect(result.end).toEqual(START);
  expect(result.stop).toBe('road_end');
});

// Value: protects=a long move stops at a T-junction, where signs usually are, instead of picking a side at random; fails_when=the walk turns onto the cross street; seam=metadata lookup; no_claim=real junction layouts.
test('a long move stops at a T-junction instead of turning onto the cross street', async () => {
  const east = leg('e', ORIGIN, 90, 200, 10);
  const end = east.at(-1) ?? START;
  const cross = [...leg('cn', end, 0, 300, 10), ...leg('cs', end, 180, 300, 10)];
  const { result } = await walk([...east, ...cross], 90, 1000);
  expect(result.stop).toBe('road_end');
  expect(result.end.panoId).toBe(end.panoId);
});

// Value: protects=the walk never loops on a roundabout; fails_when=a visited panorama is entered again, so the hops outnumber the panoramas; seam=metadata lookup; no_claim=the order in which a small ring is crossed.
test('a long move does not go round a loop twice', async () => {
  const centre = destinationPoint(ORIGIN.lat, ORIGIN.lng, 0, 0.03);
  const ring: PanoPoint[] = [];
  for (let deg = 15; deg < 360; deg += 15) {
    const p = destinationPoint(centre.lat, centre.lng, 180 - deg, 0.03);
    ring.push({ panoId: `r${deg}`, lat: p.lat, lng: p.lng });
  }
  const { result } = await walk(ring, 90, 2000);
  expect(result.stop).not.toBe('reached');
  expect(result.hops).toBeGreaterThan(0);
  expect(result.hops).toBeLessThanOrEqual(ring.length);
});

// Value: protects=a winding road cannot hold a move for an unbounded number of lookups; fails_when=the probe cap is ignored; seam=metadata lookup; no_claim=the right size of the cap.
test('the walk stops at the lookup cap and keeps what it covered', async () => {
  let n = 0;
  let calls = 0;
  const result = await walkRoad({
    start: START,
    headingDeg: 90,
    distanceM: 2000,
    // Only the shortest probe ever finds a panorama, exactly where it asked.
    queryMetadata: (lat, lng, radius = 5000) => {
      calls += 1;
      if (radius > 35) return Promise.resolve({ status: 'ZERO_RESULTS' });
      n += 1;
      return Promise.resolve({
        status: 'OK',
        pano_id: `p${n}`,
        location: { lat, lng },
        copyright: '© Google',
      });
    },
  });
  expect(result.stop).toBe('search_limit');
  expect(calls).toBe(MAX_WALK_PROBES);
  expect(result.hops).toBeGreaterThan(10);
  expect(result.travelledM).toBeLessThan(2000);
});

test('the walk stops at the time limit and on an aborted round', async () => {
  const road = roadService(leg('e', ORIGIN, 90, 3000, 10));
  let clock = 0;
  const slow = await walkRoad({
    start: START,
    headingDeg: 90,
    distanceM: 2000,
    queryMetadata: road.service.queryMetadata,
    now: () => {
      clock += 3_000;
      return clock;
    },
  });
  expect(slow.stop).toBe('search_limit');
  expect(slow.hops).toBeGreaterThan(0);

  const aborted = await walkRoad({
    start: START,
    headingDeg: 90,
    distanceM: 2000,
    queryMetadata: road.service.queryMetadata,
    signal: AbortSignal.abort(),
  });
  expect(aborted.stop).toBe('aborted');
  expect(aborted.hops).toBe(0);
});

// Value: protects=photo spheres uploaded by users are not treated as road panoramas; fails_when=the copyright check is dropped from the walk; seam=metadata lookup; no_claim=none.
test('a panorama that is not from the road network is skipped', async () => {
  const panos = leg('e', ORIGIN, 90, 60, 10);
  const road = roadService(panos, { foreign: new Set(panos.map((p) => p.panoId)) });
  const result = await walkRoad({
    start: START,
    headingDeg: 90,
    distanceM: null,
    queryMetadata: road.service.queryMetadata,
  });
  expect(result.hops).toBe(0);
});

// Value: protects=a panorama a few metres away under another id is not counted as a hop; fails_when=the minimum-advance guard is dropped and a duplicate counts as movement; why_new=no other road in this file has a panorama inside the 3 m minimum; seam=metadata lookup; no_claim=how often real roads repeat a place.
test('a panorama closer than the minimum advance is not a hop', async () => {
  const near = destinationPoint(ORIGIN.lat, ORIGIN.lng, 90, 0.002);
  const { result } = await walk([{ panoId: 'twin', ...near }], 90, null);
  expect(result.hops).toBe(0);
  expect(result.end).toEqual(START);
});

// Value: protects=the first hop snaps the asked heading to a road within a quarter turn and refuses a road beyond it; fails_when=the first-hop turn limit is removed or tightened to the follow limit; why_new=the other roads start dead ahead or dead behind, so no test had a first hop between the two limits; seam=metadata lookup; no_claim=real junction angles.
test('the first hop snaps to a road within a quarter turn and refuses one beyond it', async () => {
  // 75 degrees is inside the first-hop limit (90) and outside the follow limit (60).
  const snapped = await walk(leg('s', ORIGIN, 75, 200, 10), 0, null);
  expect(snapped.result.hops).toBe(1);
  expect(turnDeg(snapped.result.headingDeg, 75)).toBeLessThan(5);
  const refused = await walk(leg('r', ORIGIN, 120, 200, 10), 0, null);
  expect(refused.result.hops).toBe(0);
  expect(refused.result.stop).toBe('road_end');
});

// Value: protects=on a road where the long reach never lands, the walk stays off it for longer after every miss and covers the distance inside the lookup cap; fails_when=the wait starts over as soon as the walk steps up, so the long reach is retried every fourth hop and the cap is hit short of the distance; why_new=the cap test's road answers only the shortest probe, so it hits the cap with or without the back-off; seam=metadata lookup; no_claim=how winding real roads are.
test('the walk stays off a reach for longer after every miss', async () => {
  let longMisses = 0;
  let found = 0;
  const result = await walkRoad({
    start: START,
    headingDeg: 90,
    distanceM: 2000,
    // The 150 m probe never lands; a shorter one finds a panorama exactly where it asked.
    queryMetadata: (lat, lng, radius = 5000) => {
      if (radius > 40) {
        longMisses += 1;
        return Promise.resolve({ status: 'ZERO_RESULTS' });
      }
      found += 1;
      return Promise.resolve({
        status: 'OK',
        pano_id: `w${found}`,
        location: { lat, lng },
        copyright: '© Google',
      });
    },
  });
  expect(result.stop).toBe('reached');
  expect(result.travelledM).toBeGreaterThanOrEqual(1990);
  expect(longMisses).toBeLessThanOrEqual(6);
});

// Value: protects=the time limit stops the walk between two lookups of one hop; fails_when=the clock is read once per hop, so a hop of slow misses makes all four of its lookups and reports that the road ended; why_new=the older time test has hops of one lookup each; seam=metadata lookup and the clock; no_claim=real lookup latency.
test('the time limit stops the walk between the lookups of one hop', async () => {
  let clock = 0;
  let calls = 0;
  const result = await walkRoad({
    start: START,
    headingDeg: 90,
    distanceM: 2000,
    // Every lookup misses and takes five seconds of the walk's clock.
    queryMetadata: () => {
      calls += 1;
      clock += 5_000;
      return Promise.resolve({ status: 'ZERO_RESULTS' });
    },
    now: () => clock,
  });
  expect(result.stop).toBe('search_limit');
  expect(result.hops).toBe(0);
  expect(calls).toBe(2);
});

// Value: protects=a lookup that never answers cannot hold a move past the walk's time limit or past the end of the round, and the walk keeps the hops it made; fails_when=the walk waits for the lookup itself; why_new=every other lookup in this file answers at once; seam=metadata lookup, the clock and the round signal; no_claim=the lookup's own HTTP timeout.
test('a lookup that hangs is cut off at the time limit and at the end of the round', async () => {
  const road = roadService(leg('e', ORIGIN, 90, 3000, 10));
  const hangAtThird = (onHang: () => void) => {
    let calls = 0;
    return (lat: number, lng: number, radius?: number) => {
      calls += 1;
      if (calls <= 2) return road.service.queryMetadata(lat, lng, radius);
      onHang();
      return new Promise<null>(() => undefined);
    };
  };
  let clock = 0;
  const late = await walkRoad({
    start: START,
    headingDeg: 90,
    distanceM: 2000,
    // The third lookup starts 20 ms before the limit and never answers.
    queryMetadata: hangAtThird(() => (clock = MAX_WALK_MS - 20)),
    now: () => clock,
  });
  expect(late.stop).toBe('search_limit');
  expect(late.hops).toBe(2);

  const round = new AbortController();
  const ended = await walkRoad({
    start: START,
    headingDeg: 90,
    distanceM: 2000,
    queryMetadata: hangAtThird(() =>
      setTimeout(() => {
        round.abort();
      }, 5),
    ),
    signal: round.signal,
  });
  expect(ended.stop).toBe('aborted');
  expect(ended.hops).toBe(2);
});

// Value: protects=a lookup error after the walk has moved ends it there with what it covered, and an error before the first hop still reaches the caller; fails_when=the error throws away the hops already made, or a failing first lookup is reported as a missing road; why_new=no other lookup in this file fails; seam=metadata lookup; no_claim=which errors the metadata service returns.
test('a lookup error ends a walk that has moved and is thrown before the first hop', async () => {
  const road = roadService(leg('e', ORIGIN, 90, 3000, 10));
  let calls = 0;
  const failAfter = (good: number) => (lat: number, lng: number, radius?: number) => {
    calls += 1;
    if (calls <= good) return road.service.queryMetadata(lat, lng, radius);
    return Promise.reject(new Error('lookup failed'));
  };
  const walked = { start: START, headingDeg: 90, distanceM: 2000 };
  const partial = await walkRoad({ ...walked, queryMetadata: failAfter(2) });
  expect(partial.stop).toBe('lookup_failed');
  expect(partial.hops).toBe(2);
  expect(partial.travelledM).toBeGreaterThan(200);
  expect(calls).toBe(3);

  calls = 0;
  const first = await walkRoad({ ...walked, queryMetadata: failAfter(0) }).catch(
    (err: unknown) => err,
  );
  expect(first).toBeInstanceOf(Error);
  expect((first as Error).message).toBe('lookup failed');
});
