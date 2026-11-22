import { expect, test } from 'bun:test';
import { haversineDistanceKm } from '../../shared/score.ts';
import { leg, ORIGIN, roadService, START } from '../../test/fixtures/road.ts';
import {
  bearingDeg,
  destinationPoint,
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
