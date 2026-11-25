import type { LatLng } from '../../shared/score.ts';
import rawData from './cities.data.json' with { type: 'json' };
import { decodeRing, type CitiesDataset } from './cities-format.ts';

type LngLat = [number, number];

/** A dense urban area of 500 thousand people or more (GHSL Urban Centre Database). */
export interface UrbanCentre {
  name: string;
  iso: string;
  population: number;
  /** The core city: the largest known place inside the outline. */
  core: LatLng;
  /** Outer rings of the dense area as `[lng, lat]` degrees. */
  rings: LngLat[][];
  bbox: [number, number, number, number];
}

function ringsBbox(rings: readonly LngLat[][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

export const URBAN_CENTRES: readonly UrbanCentre[] = (rawData as CitiesDataset).centres.map(
  (record) => {
    const rings = record.rings.map((flat) => decodeRing(flat));
    return {
      name: record.name,
      iso: record.iso,
      population: record.pop,
      core: { lat: record.core[0], lng: record.core[1] },
      rings,
      bbox: ringsBbox(rings),
    };
  },
);
