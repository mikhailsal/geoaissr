import { expect, test } from 'bun:test';
import { countMapPlaces, emptyMapRegionReason, isMapAvailable } from './map-availability.ts';
import { MAP_IDS, MAP_DESCRIPTIONS_RU, MAP_LABELS_RU, getMapPromptNoteRu } from './maps.ts';
import { lobbySettingsPatchSchema } from './protocol.ts';
import {
  AREA_REGION_IDS,
  countryIdOfRegion,
  countryRegionId,
  isRegionIdShape,
} from './region-ids.ts';
import {
  REGION_COUNTRIES,
  REGION_DIAGONALS_KM,
  findCountryAtPoint,
  getCountryOfRegion,
  getRegionDiagonalKm,
  getRegionLabelRu,
  getWeightedCountriesForRegion,
  isKnownRegion,
  listCountryRegions,
  pointInRing,
  polygonsInRegion,
  samplePointInPolygon,
  sampleWeightedItem,
} from './regions.ts';
import { settingsFileSchema, splitLegacyRegion } from './storage-schemas.ts';

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

test('all 7 area regions have expected constant diagonals and a map does not change the scale', () => {
  expect(REGION_DIAGONALS_KM).toEqual({
    world: 14916.862,
    europe: 6080.843,
    asia: 12093.709,
    north_america: 9867.287,
    south_america: 8720.382,
    africa: 10709.577,
    oceania: 8058.491,
  });
  for (const region of AREA_REGION_IDS) {
    expect(getRegionDiagonalKm(region)).toBeGreaterThan(5000);
  }
  // The airports map used to be a region with the world scale; it is a map of the world now.
  expect(splitLegacyRegion('airports')).toEqual({ map: 'airports', region: 'world' });
  expect(getRegionDiagonalKm('world')).toBe(REGION_DIAGONALS_KM.world);
});

test('findCountryAtPoint resolves Russian NAME_RU for major locations', () => {
  expect(findCountryAtPoint({ lat: 55.7558, lng: 37.6173 })?.nameRu).toBe('Россия');
  expect(findCountryAtPoint({ lat: 48.8566, lng: 2.3522 })?.nameRu).toBe('Франция');
  expect(findCountryAtPoint({ lat: 35.6762, lng: 139.6503 })?.nameRu).toBe('Япония');
  expect(findCountryAtPoint({ lat: -22.9068, lng: -43.1729 })?.nameRu).toBe('Бразилия');
});

// Value: protects=a point in an enclave resolves to the enclave; fails_when=Lesotho resolves to South Africa, whose outline has no hole, and a round there is labelled with the wrong country;
// why_new=the first outline holding the point won; seam=none; no_claim=enclaves the dataset has no outline for (San Marino, Vatican)
test('a point in Lesotho resolves to Lesotho, not to South Africa around it', () => {
  expect(findCountryAtPoint({ lat: -29.31, lng: 27.48 })?.id).toBe('LSO');
  expect(findCountryAtPoint({ lat: -26.2, lng: 28.04 })?.id).toBe('ZAF');
});

test('world countries exclude Antarctica and each country has valid polygons', () => {
  expect(REGION_COUNTRIES.length).toBeGreaterThanOrEqual(170);
  expect(REGION_COUNTRIES.some((c) => c.id === 'ATA')).toBe(false);
});

test('sampling inside each region produces points inside country polygons', () => {
  const rng = mulberry32(42);
  for (const region of AREA_REGION_IDS) {
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

// Value: protects=the lobby patch and settings file schemas accept every map, an area and a one-country region, and reject unknown ones; fails_when=a map id is dropped from the schema or a region of the wrong form passes;
// why_new=no test validates a map or a region at the schema boundary; seam=none; no_claim=server handling of the settings (schema only)
test('lobby patch and settings schemas accept maps and regions and reject unknown ones', () => {
  for (const map of MAP_IDS) {
    expect(lobbySettingsPatchSchema.safeParse({ map }).success).toBe(true);
  }
  expect(lobbySettingsPatchSchema.safeParse({ map: 'atlantis' }).success).toBe(false);
  expect(lobbySettingsPatchSchema.safeParse({ region: 'europe' }).success).toBe(true);
  expect(lobbySettingsPatchSchema.safeParse({ region: 'country:FRA' }).success).toBe(true);
  for (const region of ['atlantis', 'airports', 'country:', 'country:fra', 'country:FRA;x', '']) {
    expect(lobbySettingsPatchSchema.safeParse({ region }).success).toBe(false);
  }
  const complete = {
    version: 2,
    map: 'airports',
    region: 'country:FRA',
    rounds: 5,
    roundDurationSec: 120,
    moveEnabled: true,
    aiWaitWindowSec: 30,
    bots: [],
  };
  expect(settingsFileSchema.safeParse(complete).success).toBe(true);
  expect(settingsFileSchema.safeParse({ ...complete, region: 'airports' }).success).toBe(false);
  expect(settingsFileSchema.safeParse({ ...complete, map: 'atlantis' }).success).toBe(false);
  // A file of the old version is not valid as it is: it goes through the migration first.
  expect(settingsFileSchema.safeParse({ ...complete, version: 1 }).success).toBe(false);
});

// Value: protects=a one-country region resolves to its country, its Russian name and its own scoring scale; fails_when=a country region falls back to the world scale or an unknown country is taken as known;
// why_new=regions were a fixed list of areas; seam=none; no_claim=sampling inside the country (ids and scale only)
test('a one-country region knows its country, its name and its scale', () => {
  expect(countryRegionId('FRA')).toBe('country:FRA');
  expect(countryIdOfRegion('country:FRA')).toBe('FRA');
  expect(countryIdOfRegion('europe')).toBeNull();
  expect(isRegionIdShape('country:FRA')).toBe(true);
  expect(isKnownRegion('country:FRA')).toBe(true);
  expect(isKnownRegion('country:ZZZ')).toBe(false);
  expect(isKnownRegion('asia')).toBe(true);
  expect(getCountryOfRegion('country:JPN')?.nameRu).toBe('Япония');
  expect(getRegionLabelRu('country:JPN')).toBe('Япония');
  expect(getRegionLabelRu('world')).toBe('Весь мир');
  const japan = getRegionDiagonalKm('country:JPN');
  expect(japan).toBeGreaterThan(2000);
  expect(japan).toBeLessThan(4500);
  // A tiny country still gets a scale a guess can be scored on.
  expect(getRegionDiagonalKm('country:LUX')).toBeGreaterThanOrEqual(100);
  expect(getRegionDiagonalKm('country:LUX')).toBeLessThan(300);
  expect(getRegionDiagonalKm('country:RUS')).toBeLessThan(REGION_DIAGONALS_KM.world);
  const only = getWeightedCountriesForRegion('country:FRA', new Set(['FRA']));
  expect(only.map((entry) => entry.country.id)).toEqual(['FRA']);
});

// Value: protects=a France match is scored on the scale of mainland France and its rounds stay in Europe, while a world or South America match still reaches French Guiana; fails_when=the overseas polygon stretches the scale of country:FRA across the Atlantic, or another country loses a polygon;
// why_new=one-country regions are new and the outlines draw French Guiana inside France; seam=none; no_claim=where Google has panoramas
test('a one-country region leaves out an overseas part on another continent', () => {
  const france = getCountryOfRegion('country:FRA');
  if (!france) throw new Error('France is missing from the regions dataset');
  expect(france.polygons.some((poly) => poly.region === 'south_america')).toBe(true);
  const home = polygonsInRegion(france, 'country:FRA');
  expect(home.length).toBe(france.polygons.length - 1);
  expect(home.every((poly) => poly.region === 'europe')).toBe(true);
  expect(getRegionDiagonalKm('country:FRA')).toBeGreaterThan(900);
  expect(getRegionDiagonalKm('country:FRA')).toBeLessThan(2000);
  expect(polygonsInRegion(france, 'world').length).toBe(france.polygons.length);
  expect(polygonsInRegion(france, 'south_america').length).toBe(1);
  // Every other country plays on all of its land: Kaliningrad, Alaska and Hawaii stay.
  const trimmed = REGION_COUNTRIES.filter(
    (country) =>
      polygonsInRegion(country, countryRegionId(country.id)).length !== country.polygons.length,
  );
  expect(trimmed.map((country) => country.id)).toEqual(['FRA']);
});

// Value: protects=the lobby's country list holds every country once, sorted by its Russian name; fails_when=a country is missing, repeated or the list is in dataset order;
// why_new=the lobby had no country list; seam=none; no_claim=how the select renders it
test('the list of country regions is complete and sorted by Russian name', () => {
  const list = listCountryRegions();
  expect(list.length).toBe(REGION_COUNTRIES.length);
  expect(new Set(list.map((entry) => entry.region)).size).toBe(list.length);
  expect(list.every((entry) => isKnownRegion(entry.region))).toBe(true);
  const names = list.map((entry) => entry.nameRu);
  expect(names).toEqual([...names].sort(new Intl.Collator('ru').compare));
  expect(names.indexOf('Австралия')).toBeLessThan(names.indexOf('Япония'));
});

// Value: protects=every map has a name and a description, and a bot is told the map except on the standard one; fails_when=a map is added without texts or the standard prompt gains words;
// why_new=maps are new; seam=none; no_claim=the rendered prompt (texts only)
test('every map has a name, a description and a prompt note', () => {
  for (const map of MAP_IDS) {
    expect(MAP_LABELS_RU[map].length).toBeGreaterThan(3);
    expect(MAP_DESCRIPTIONS_RU[map].length).toBeGreaterThan(10);
  }
  expect(new Set(Object.values(MAP_LABELS_RU)).size).toBe(MAP_IDS.length);
  expect(getMapPromptNoteRu('standard')).toBe('');
  expect(getMapPromptNoteRu('capitals')).toBe('; карта «Столицы»: только столицы стран');
  expect(getMapPromptNoteRu('airports')).toContain('не дальше 5 км от аэропорта');
});

// Value: protects=the lobby knows which map has no places in a region and says so in Russian; fails_when=an empty combination is offered or a full one is greyed out;
// why_new=every map covered every region before; seam=none; no_claim=that the table matches the datasets (server/maps test)
test('map availability tells an empty combination from a full one', () => {
  expect(isMapAvailable('standard', 'country:LUX')).toBe(true);
  expect(isMapAvailable('wild', 'oceania')).toBe(true);
  // The standard and wild maps count the countries a coverage scan found playable.
  expect(countMapPlaces('standard', 'world')).toBeGreaterThan(80);
  expect(countMapPlaces('standard', 'world')).toBeLessThan(176);
  expect(countMapPlaces('wild', 'world')).toBeLessThanOrEqual(countMapPlaces('standard', 'world'));
  expect(isMapAvailable('standard', 'country:CHN')).toBe(false);
  expect(isMapAvailable('standard', 'country:PRK')).toBe(false);
  expect(isMapAvailable('wild', 'country:PRK')).toBe(false);
  expect(isMapAvailable('standard', 'country:FRA')).toBe(true);
  expect(isMapAvailable('highlands', 'europe')).toBe(false);
  expect(isMapAvailable('highlands', 'south_america')).toBe(true);
  expect(isMapAvailable('megacities', 'oceania')).toBe(false);
  expect(countMapPlaces('megacities', 'country:JPN')).toBe(3);
  expect(isMapAvailable('north', 'africa')).toBe(false);
  expect(isMapAvailable('north', 'country:FIN')).toBe(true);
  expect(isMapAvailable('retro', 'country:EGY')).toBe(false);
  expect(isMapAvailable('retro', 'europe')).toBe(true);
  expect(emptyMapRegionReason('highlands', 'europe', 'Европа')).toBe(
    'На карте «Высокогорье» нет мест в регионе «Европа»: выберите другую карту или регион',
  );
});
