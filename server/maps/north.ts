import type { RegionId } from '../../shared/region-ids.ts';
import {
  getWeightedCountriesForRegion,
  type RegionPolygon,
  type WeightedCountry,
} from '../../shared/regions.ts';

/** The north map holds only places at or above this latitude. */
export const NORTH_MIN_LAT = 60;

type LngLat = [number, number];

/** Cuts a ring along a parallel and keeps the part north of it (Sutherland-Hodgman). */
export function clipRingNorthOf(ring: readonly LngLat[], minLat: number): LngLat[] {
  const open = ring.length > 1 ? ring.slice(0, -1) : [...ring];
  const out: LngLat[] = [];
  for (let i = 0; i < open.length; i += 1) {
    const curr = open[i];
    const prev = open[(i - 1 + open.length) % open.length];
    if (!curr || !prev) continue;
    const currIn = curr[1] >= minLat;
    const prevIn = prev[1] >= minLat;
    if (currIn !== prevIn) {
      const t = (minLat - prev[1]) / (curr[1] - prev[1]);
      out.push([prev[0] + t * (curr[0] - prev[0]), minLat]);
    }
    if (currIn) out.push(curr);
  }
  const first = out[0];
  if (out.length < 3 || !first) return [];
  out.push(first);
  return out;
}

function clipPolygon(poly: RegionPolygon): RegionPolygon | null {
  if (poly.bbox[3] < NORTH_MIN_LAT) return null;
  const ring = clipRingNorthOf(poly.ring, NORTH_MIN_LAT);
  if (ring.length < 4) return null;
  let doubled = 0;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (!a || !b) continue;
    doubled += a[0] * b[1] - b[0] * a[1];
    minLng = Math.min(minLng, a[0]);
    maxLng = Math.max(maxLng, a[0]);
    maxLat = Math.max(maxLat, a[1]);
  }
  // The same flat-map area the regions dataset stores: square degrees shrunk by cos(latitude).
  const midLat = (NORTH_MIN_LAT + maxLat) / 2;
  const area = (Math.abs(doubled) / 2) * Math.max(0.15, Math.cos((midLat * Math.PI) / 180));
  if (area <= 0) return null;
  return { region: poly.region, bbox: [minLng, NORTH_MIN_LAT, maxLng, maxLat], area, ring };
}

const cache = new Map<RegionId, WeightedCountry[]>();

/** Countries of the region with land north of the line, each cut down to that land. */
function northCountries(region: RegionId): WeightedCountry[] {
  const cached = cache.get(region);
  if (cached) return cached;
  const result: WeightedCountry[] = [];
  for (const entry of getWeightedCountriesForRegion(region)) {
    const polygons = entry.polygons.flatMap((poly) => clipPolygon(poly) ?? []);
    if (polygons.length === 0) continue;
    const area = polygons.reduce((sum, poly) => sum + poly.area, 0);
    result.push({ country: entry.country, polygons, weight: Math.pow(Math.max(0.01, area), 0.65) });
  }
  cache.set(region, result);
  return result;
}

/** The same, minus countries already played; every country again once all were played. */
export function getNorthCountries(
  region: RegionId,
  excludeCountryIds: ReadonlySet<string> = new Set(),
): WeightedCountry[] {
  const all = northCountries(region);
  const open = all.filter((entry) => !excludeCountryIds.has(entry.country.id));
  return open.length > 0 ? open : all;
}
