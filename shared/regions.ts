import rawData from './regions.data.json' with { type: 'json' };
import { computeRingsDiagonalKm } from './region-geometry.ts';
import {
  countryIdOfRegion,
  countryRegionId,
  isAreaRegionId,
  type AreaRegionId,
  type ContinentId,
  type CountryRegionId,
  type RegionId,
} from './region-ids.ts';
import { haversineDistanceKm, type LatLng } from './score.ts';

type LngLat = [number, number];

export interface RegionPolygon {
  region: ContinentId;
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
  diagonalsKm: Record<AreaRegionId, number>;
  countries: RegionCountry[];
}

const dataset = rawData as RawRegionsDataset;

export const REGION_DIAGONALS_KM: Readonly<Record<AreaRegionId, number>> = dataset.diagonalsKm;
export const REGION_COUNTRIES: readonly RegionCountry[] = dataset.countries;

const COUNTRY_BY_ID = new Map(REGION_COUNTRIES.map((country) => [country.id, country]));

export const AREA_REGION_LABELS_RU: Readonly<Record<AreaRegionId, string>> = {
  world: 'Весь мир',
  europe: 'Европа',
  asia: 'Азия',
  north_america: 'Северная Америка',
  south_america: 'Южная Америка',
  africa: 'Африка',
  oceania: 'Океания',
};

/**
 * The outlines are coarse (1:110m), so the box around a small country can come out smaller than
 * the country. The floor keeps the scoring scale of such a country usable.
 */
const MIN_COUNTRY_DIAGONAL_KM = 100;
const countryDiagonals = new Map<string, number>();

/** The country a one-country region names, or null for an area or an unknown country. */
export function getCountryOfRegion(region: RegionId): RegionCountry | null {
  const id = countryIdOfRegion(region);
  return id === null ? null : (COUNTRY_BY_ID.get(id) ?? null);
}

/** Whether the region exists: an area, or a country of the regions dataset. */
export function isKnownRegion(region: RegionId): boolean {
  return isAreaRegionId(region) || getCountryOfRegion(region) !== null;
}

export function getRegionLabelRu(region: RegionId): string {
  if (isAreaRegionId(region)) return AREA_REGION_LABELS_RU[region];
  return getCountryOfRegion(region)?.nameRu ?? region;
}

/** Every country as a region choice, sorted by its Russian name. */
export function listCountryRegions(): { region: CountryRegionId; nameRu: string }[] {
  const collator = new Intl.Collator('ru');
  return REGION_COUNTRIES.map((country) => ({
    region: countryRegionId(country.id),
    nameRu: country.nameRu,
  })).sort((a, b) => collator.compare(a.nameRu, b.nameRu));
}

/** The distance scale of scoring: the diagonal of the box around the region. */
export function getRegionDiagonalKm(region: RegionId): number {
  if (isAreaRegionId(region)) return REGION_DIAGONALS_KM[region];
  const country = getCountryOfRegion(region);
  if (!country) return REGION_DIAGONALS_KM.world;
  const known = countryDiagonals.get(country.id);
  if (known !== undefined) return known;
  const diagonal = Math.max(
    MIN_COUNTRY_DIAGONAL_KM,
    computeRingsDiagonalKm(country.polygons.map((poly) => poly.ring)),
  );
  countryDiagonals.set(country.id, diagonal);
  return diagonal;
}

/** The polygons of a country that lie inside the region. */
export function polygonsInRegion(country: RegionCountry, region: RegionId): RegionPolygon[] {
  if (region === 'world') return country.polygons;
  if (isAreaRegionId(region)) return country.polygons.filter((p) => p.region === region);
  return countryIdOfRegion(region) === country.id ? country.polygons : [];
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
    const polys = polygonsInRegion(country, region);
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
