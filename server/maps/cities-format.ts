/** Layout of `cities.data.json`, shared by its reader and by `scripts/build-cities.ts`. */

/** Ring coordinates are stored as integers of thousandths of a degree (about 110 m). */
export const CITY_COORD_SCALE = 1000;

export interface CityCentreRecord {
  /** Main name of the urban centre in the source, in Latin script. Not shown to players. */
  name: string;
  /** ISO 3166-1 alpha-2 code of the core city. */
  iso: string;
  /** People inside the outline (2025 estimate), rounded to thousands. */
  pop: number;
  /** Latitude and longitude of the core city: the largest known place inside the outline. */
  core: [number, number];
  /** Outer rings of the dense area, each packed by `encodeRing`. */
  rings: number[][];
}

export interface CitiesDataset {
  version: 1;
  source: string;
  /** Urban centres of 500 thousand people or more, largest first. */
  centres: CityCentreRecord[];
}

/**
 * Packs a ring of `[lng, lat]` degrees into integers: the first point in thousandths of a degree,
 * then the difference to each next point. Repeated points after rounding are dropped.
 */
export function encodeRing(ring: readonly (readonly [number, number])[]): number[] {
  const flat: number[] = [];
  let prevLng = 0;
  let prevLat = 0;
  for (const [lng, lat] of ring) {
    const qLng = Math.round(lng * CITY_COORD_SCALE);
    const qLat = Math.round(lat * CITY_COORD_SCALE);
    if (flat.length > 0 && qLng === prevLng && qLat === prevLat) continue;
    flat.push(flat.length === 0 ? qLng : qLng - prevLng, flat.length === 0 ? qLat : qLat - prevLat);
    prevLng = qLng;
    prevLat = qLat;
  }
  return flat;
}

/** The reverse of `encodeRing`: a ring of `[lng, lat]` degrees. */
export function decodeRing(flat: readonly number[]): [number, number][] {
  const ring: [number, number][] = [];
  let lng = 0;
  let lat = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    lng += flat[i] ?? 0;
    lat += flat[i + 1] ?? 0;
    ring.push([lng / CITY_COORD_SCALE, lat / CITY_COORD_SCALE]);
  }
  return ring;
}
