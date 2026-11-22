import { normalizeLongitude } from '../../shared/bot-tools.ts';
import { haversineDistanceKm } from '../../shared/score.ts';
import type { LocationService } from '../location.ts';

/**
 * Walks along a road from panorama to panorama with Street View metadata lookups only (they are
 * free of charge and use no quota). The metadata API has no "neighbours" list, so each hop asks
 * for the panorama nearest to a point ahead on the current bearing; the next hop then continues
 * on the bearing of the hop just made, which follows the bends of the road.
 */

const EARTH_RADIUS_KM = 6371;

export interface PanoPoint {
  panoId: string;
  lat: number;
  lng: number;
}

/** Why a walk ended: the distance was covered, the road gave out, or the search budget did. */
export type WalkStop = 'reached' | 'road_end' | 'search_limit' | 'aborted';

export interface WalkResult {
  /** Where the walk ended; the start itself when no panorama was found. */
  end: PanoPoint;
  hops: number;
  travelledM: number;
  /** Bearing of the last hop, or the requested heading when nothing moved. */
  headingDeg: number;
  stop: WalkStop;
}

interface Probe {
  aheadM: number;
  radiusM: number;
}

/**
 * Probe sizes from the longest to the shortest. A probe asks for the panorama nearest to the
 * point `aheadM` ahead, within `radiusM` of it. The last entry is the single-step pair: 18 m
 * first, then 40 m for roads where panoramas are far apart.
 */
const REACHES: readonly (readonly Probe[])[] = [
  [{ aheadM: 150, radiusM: 75 }],
  [{ aheadM: 60, radiusM: 40 }],
  [
    { aheadM: 18, radiusM: 35 },
    { aheadM: 40, radiusM: 35 },
  ],
];
const NEAR = REACHES.length - 1;

/** The first hop may leave the requested heading by a quarter turn: it snaps to the road. */
const FIRST_HOP_MAX_TURN_DEG = 90;
/** Later hops follow the road; a sharper turn is a junction or a dead end, and the walk stops. */
const FOLLOW_MAX_TURN_DEG = 60;
/** A "new" panorama closer than this is the same place under another id. */
const MIN_ADVANCE_M = 3;
/** The walk counts as arrived when this close to the requested distance. */
const ARRIVAL_SLACK_M = 10;
export const MAX_WALK_PROBES = 40;
export const MAX_WALK_MS = 8_000;

export function destinationPoint(
  lat: number,
  lng: number,
  headingDeg: number,
  distanceKm: number,
): { lat: number; lng: number } {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const toDeg = (r: number): number => (r * 180) / Math.PI;
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const brng = toRad(headingDeg);
  const ang = distanceKm / EARTH_RADIUS_KM;

  const sinLat2 = Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lng: normalizeLongitude(toDeg(lng2)) };
}

/** Initial compass bearing from `a` to `b`, 0–360. */
export function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest angle between two bearings, 0–180. */
export function turnDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

interface WalkState {
  pos: PanoPoint;
  bearing: number;
  travelledM: number;
  hops: number;
  probes: number;
  visited: Set<string>;
}

type MetadataQuery = LocationService['queryMetadata'];

/** One metadata lookup; null when it found no usable panorama ahead. */
async function probeAhead(
  st: WalkState,
  probe: Probe,
  maxTurnDeg: number,
  queryMetadata: MetadataQuery,
): Promise<{ point: PanoPoint; stepM: number; bearing: number } | null> {
  st.probes += 1;
  const ahead = destinationPoint(st.pos.lat, st.pos.lng, st.bearing, probe.aheadM / 1000);
  const meta = await queryMetadata(ahead.lat, ahead.lng, probe.radiusM);
  if (meta?.status !== 'OK' || !meta.pano_id || !meta.location) return null;
  // Photos uploaded by users are single spheres off the road network.
  if (typeof meta.copyright !== 'string' || !/google/i.test(meta.copyright)) return null;
  if (st.visited.has(meta.pano_id)) return null;
  const point = { panoId: meta.pano_id, lat: meta.location.lat, lng: meta.location.lng };
  const stepM = haversineDistanceKm(st.pos, point) * 1000;
  if (stepM < MIN_ADVANCE_M) return null;
  const bearing = bearingDeg(st.pos, point);
  if (turnDeg(bearing, st.bearing) > maxTurnDeg) return null;
  return { point, stepM, bearing };
}

/** Tries every probe of one reach; moves the walk and returns true on the first that hits. */
async function tryReach(
  st: WalkState,
  reach: number,
  queryMetadata: MetadataQuery,
): Promise<boolean> {
  const maxTurnDeg = st.hops === 0 ? FIRST_HOP_MAX_TURN_DEG : FOLLOW_MAX_TURN_DEG;
  for (const probe of REACHES[reach] ?? []) {
    if (st.probes >= MAX_WALK_PROBES) return false;
    const found = await probeAhead(st, probe, maxTurnDeg, queryMetadata);
    if (!found) continue;
    st.pos = found.point;
    st.bearing = found.bearing;
    st.travelledM += found.stepM;
    st.hops += 1;
    st.visited.add(found.point.panoId);
    return true;
  }
  return false;
}

/**
 * One hop: tries the reaches from `firstReach` down to the single-step pair and returns the
 * reach that hit. A long move (`jumpGaps`) then also tries the reaches longer than `firstReach`:
 * a short probe cannot cross a gap in the coverage or a hairpin, and a long one can.
 */
async function hop(
  st: WalkState,
  firstReach: number,
  jumpGaps: boolean,
  queryMetadata: MetadataQuery,
): Promise<number | null> {
  for (let reach = firstReach; reach <= NEAR; reach += 1) {
    if (await tryReach(st, reach, queryMetadata)) return reach;
  }
  if (!jumpGaps) return null;
  for (let reach = firstReach - 1; reach >= 0; reach -= 1) {
    if (await tryReach(st, reach, queryMetadata)) return reach;
  }
  return null;
}

/** The longest reach that does not overshoot what is left by more than its own radius. */
function reachFor(remainingM: number): number {
  const fits = REACHES.findIndex((probes) => (probes[0]?.aheadM ?? 0) <= remainingM);
  return fits === -1 ? NEAR : fits;
}

/** Longest wait, in hops, before a reach that missed is tried again. */
const MAX_HOLD_HOPS = 8;

/** Which reach the next hop starts from, and how long to stay off a reach that missed. */
interface Pace {
  reach: number;
  hold: number;
  wait: number;
}

/**
 * Picks the reach of the next hop. A lookup that misses is wasted, so after a longer reach
 * missed the walk stays on the one that hit for a few hops, doubling that wait on each further
 * miss (a winding road), and steps one size up again once the wait is over.
 */
function repace(pace: Pace, tried: number, hit: number, firstHop: boolean): void {
  if (firstHop) {
    // The first hop only snapped the requested heading to the road: its misses say nothing.
    pace.reach = 0;
    return;
  }
  if (hit > tried) {
    pace.hold = Math.min(MAX_HOLD_HOPS, pace.hold * 2);
    pace.wait = pace.hold;
    pace.reach = hit;
  } else if (pace.wait > 0) {
    pace.wait -= 1;
    pace.reach = hit;
  } else {
    pace.hold = 1;
    pace.reach = Math.max(0, hit - 1);
  }
}

/**
 * Walks from `start` along the road. `distanceM: null` is the single short step (one hop);
 * a number is the long move: hops continue until that distance is covered, the road ends, or
 * the search budget (probes, time) runs out. The walk never returns to a panorama it left.
 */
export async function walkRoad(opts: {
  start: PanoPoint;
  headingDeg: number;
  distanceM: number | null;
  queryMetadata: MetadataQuery;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<WalkResult> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const st: WalkState = {
    pos: opts.start,
    bearing: opts.headingDeg,
    travelledM: 0,
    hops: 0,
    probes: 0,
    visited: new Set([opts.start.panoId]),
  };
  const done = (stop: WalkStop): WalkResult => ({
    end: st.pos,
    hops: st.hops,
    travelledM: st.travelledM,
    headingDeg: st.bearing,
    stop,
  });
  const targetM = opts.distanceM;
  const pace: Pace = { reach: 0, hold: 1, wait: 0 };
  for (;;) {
    if (opts.signal?.aborted) return done('aborted');
    if (st.probes >= MAX_WALK_PROBES || now() - startedAt > MAX_WALK_MS) {
      return done('search_limit');
    }
    const tried = targetM === null ? NEAR : Math.max(pace.reach, reachFor(targetM - st.travelledM));
    const hit = await hop(st, tried, targetM !== null, opts.queryMetadata);
    if (hit === null) return done(st.probes >= MAX_WALK_PROBES ? 'search_limit' : 'road_end');
    if (targetM === null || st.travelledM >= targetM - ARRIVAL_SLACK_M) return done('reached');
    repace(pace, tried, hit, st.hops === 1);
  }
}
