import rawData from './regions.data.json' with { type: 'json' };
import { haversineDistanceKm, type LatLng } from './score.ts';
import type { RegionId } from './storage-schemas.ts';

type LngLat = [number, number];
type PolyContinent = Exclude<RegionId, 'world'>;

export interface RegionPolygon {
  region: PolyContinent;
  bbox: [number, number, number, number];
  area: number;
  ring: LngLat[];
}

export interface RegionCountry {
  id: string;
  iso: string;
  nameRu: string;
  polygons: RegionPolygon[];
}

interface RawRegionsDataset {
  version: number;
  diagonalsKm: Record<RegionId, number>;
  countries: RegionCountry[];
}

const dataset = rawData as RawRegionsDataset;

export const REGION_DIAGONALS_KM: Readonly<Record<RegionId, number>> = dataset.diagonalsKm;
export const REGION_COUNTRIES: readonly RegionCountry[] = dataset.countries;

export function getRegionDiagonalKm(region: RegionId): number {
  return REGION_DIAGONALS_KM[region];
}

export function pointInRing(lng: number, lat: number, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInBbox(
  lng: number,
  lat: number,
  bbox: readonly [number, number, number, number],
): boolean {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function nearestCountryWithinKm(pos: LatLng, maxKm: number): RegionCountry | null {
  let bestCountry: RegionCountry | null = null;
  let bestDist = maxKm;
  for (const country of REGION_COUNTRIES) {
    for (const poly of country.polygons) {
      for (let i = 0; i < poly.ring.length; i += 1) {
        const pt = poly.ring[i];
        if (!pt) continue;
        const d = haversineDistanceKm(pos, { lat: pt[1], lng: pt[0] });
        if (d < bestDist) {
          bestDist = d;
          bestCountry = country;
        }
      }
    }
  }
  return bestCountry;
}

export function findCountryAtPoint(pos: LatLng): RegionCountry | null {
  for (const country of REGION_COUNTRIES) {
    for (const poly of country.polygons) {
      if (pointInBbox(pos.lng, pos.lat, poly.bbox) && pointInRing(pos.lng, pos.lat, poly.ring)) {
        return country;
      }
    }
  }
  return nearestCountryWithinKm(pos, 120);
}

export interface WeightedCountry {
  country: RegionCountry;
  polygons: RegionPolygon[];
  weight: number;
}

export function getWeightedCountriesForRegion(
  region: RegionId,
  excludeCountryIds: ReadonlySet<string> = new Set(),
): WeightedCountry[] {
  const all: WeightedCountry[] = [];
  for (const country of REGION_COUNTRIES) {
    const polys =
      region === 'world' ? country.polygons : country.polygons.filter((p) => p.region === region);
    if (polys.length === 0) continue;
    const totalArea = polys.reduce((acc, p) => acc + p.area, 0);
    // Sub-linear area weight (area^0.65) prevents huge uninhabited landmasses from crowding out smaller countries.
    const weight = Math.pow(Math.max(0.01, totalArea), 0.65);
    all.push({ country, polygons: polys, weight });
  }
  const filtered = all.filter((entry) => !excludeCountryIds.has(entry.country.id));
  return filtered.length > 0 ? filtered : all;
}

export function sampleWeightedItem<T extends { weight: number }>(
  items: readonly T[],
  rng: () => number,
): T {
  const total = items.reduce((sum, x) => sum + x.weight, 0);
  let cursor = rng() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  const last = items[items.length - 1];
  if (!last) throw new Error('sampleWeightedItem requires a non-empty array');
  return last;
}

export function samplePointInPolygon(poly: RegionPolygon, rng: () => number): LatLng {
  const [minLng, minLat, maxLng, maxLat] = poly.bbox;
  for (let i = 0; i < 64; i += 1) {
    const lng = minLng + rng() * (maxLng - minLng);
    const lat = minLat + rng() * (maxLat - minLat);
    if (pointInRing(lng, lat, poly.ring)) {
      return { lat, lng };
    }
  }
  const mid = poly.ring[Math.floor(poly.ring.length / 2)] ?? [0, 0];
  return { lat: mid[1], lng: mid[0] };
}
