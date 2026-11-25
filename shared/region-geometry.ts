import { haversineDistanceKm } from './score.ts';

type LngLat = readonly [number, number];

/**
 * The narrowest span of longitude that holds every value: `[west, east]`. An area that crosses
 * the antimeridian (Fiji, the Russian Far East) gets a span through it, not around the globe.
 */
export function computeMinimalLngSpan(lngs: readonly number[]): [number, number] {
  const sorted = [...lngs].sort((a, b) => a - b);
  const first = sorted.at(0);
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return [-180, 180];
  let maxGap = 360 - (last - first);
  let west = first;
  let east = last;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const cur = sorted.at(i);
    const next = sorted.at(i + 1);
    if (cur === undefined || next === undefined) continue;
    const gap = next - cur;
    if (gap > maxGap) {
      maxGap = gap;
      west = next;
      east = cur;
    }
  }
  return [west, east];
}

/** Diagonal of the box around the rings, in km: the distance scale a round is scored on. */
export function computeRingsDiagonalKm(rings: readonly (readonly LngLat[])[]): number {
  let minLat = 90;
  let maxLat = -90;
  const lngs: number[] = [];
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      lngs.push(lng);
    }
  }
  const [west, east] = computeMinimalLngSpan(lngs);
  const d = haversineDistanceKm({ lat: minLat, lng: west }, { lat: maxLat, lng: east });
  return Math.round(d * 1000) / 1000;
}
