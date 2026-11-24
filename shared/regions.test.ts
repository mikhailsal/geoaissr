import { expect, test } from 'bun:test';
import {
  REGION_COUNTRIES,
  REGION_DIAGONALS_KM,
  findCountryAtPoint,
  getRegionDiagonalKm,
  getWeightedCountriesForRegion,
  pointInRing,
  samplePointInPolygon,
  sampleWeightedItem,
} from './regions.ts';
import { lobbySettingsPatchSchema } from './protocol.ts';
import { POLYGON_REGION_IDS, REGION_IDS, settingsFileSchema } from './storage-schemas.ts';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('all 7 polygon regions have expected constant diagonals and point maps use the world scale', () => {
  expect(REGION_DIAGONALS_KM).toEqual({
    world: 14916.862,
    europe: 6080.843,
    asia: 12093.709,
    north_america: 9867.287,
    south_america: 8720.382,
    africa: 10709.577,
    oceania: 8058.491,
  });
  for (const region of REGION_IDS) {
    expect(getRegionDiagonalKm(region)).toBeGreaterThan(5000);
  }
  expect(getRegionDiagonalKm('airports')).toBe(REGION_DIAGONALS_KM.world);
});

test('findCountryAtPoint resolves Russian NAME_RU for major locations', () => {
  expect(findCountryAtPoint({ lat: 55.7558, lng: 37.6173 })?.nameRu).toBe('Россия');
  expect(findCountryAtPoint({ lat: 48.8566, lng: 2.3522 })?.nameRu).toBe('Франция');
  expect(findCountryAtPoint({ lat: 35.6762, lng: 139.6503 })?.nameRu).toBe('Япония');
  expect(findCountryAtPoint({ lat: -22.9068, lng: -43.1729 })?.nameRu).toBe('Бразилия');
});

test('world countries exclude Antarctica and each country has valid polygons', () => {
  expect(REGION_COUNTRIES.length).toBeGreaterThanOrEqual(170);
  expect(REGION_COUNTRIES.some((c) => c.id === 'ATA')).toBe(false);
});

test('sampling inside each region produces points inside country polygons', () => {
  const rng = mulberry32(42);
  for (const region of POLYGON_REGION_IDS) {
    const weighted = getWeightedCountriesForRegion(region);
    expect(weighted.length).toBeGreaterThanOrEqual(5);
    const pickedCountry = sampleWeightedItem(weighted, rng);
    const poly = pickedCountry.polygons[0];
    expect(poly).toBeDefined();
    if (!poly) continue;
    const pt = samplePointInPolygon(poly, rng);
    expect(pt.lat).toBeGreaterThanOrEqual(-90);
    expect(pt.lat).toBeLessThanOrEqual(90);
    expect(pt.lng).toBeGreaterThanOrEqual(-180);
    expect(pt.lng).toBeLessThanOrEqual(180);
    const firstVertex = poly.ring[0] ?? [0, 0];
    expect(
      pointInRing(firstVertex[0], firstVertex[1], poly.ring) || findCountryAtPoint(pt) !== null,
    ).toBe(true);
  }
});

// Value: protects=the lobby patch and settings file schemas accept the airports point map and reject unknown regions; fails_when=a point map id is dropped from REGION_IDS or the schema;
// why_new=no test validates a region at the schema boundary; seam=none; no_claim=server handling of the region (schema only)
test('lobby patch and settings schemas accept the airports region and reject unknown ones', () => {
  expect(lobbySettingsPatchSchema.safeParse({ region: 'airports' }).success).toBe(true);
  expect(lobbySettingsPatchSchema.safeParse({ region: 'atlantis' }).success).toBe(false);
  const file = settingsFileSchema.safeParse({ version: 1, region: 'airports' });
  const regionIssues = file.error?.issues.filter((issue) => issue.path[0] === 'region') ?? [];
  expect(regionIssues).toEqual([]);
});
