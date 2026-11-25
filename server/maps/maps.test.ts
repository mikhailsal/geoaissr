import { expect, test } from 'bun:test';
import rawAvailability from '../../shared/map-availability.data.json' with { type: 'json' };
import { REGION_COUNTRIES, pointInRing } from '../../shared/regions.ts';
import { haversineDistanceKm } from '../../shared/score.ts';
import { computeMapAvailability } from './availability.ts';
import { URBAN_CENTRES } from './cities.ts';
import { continentOfPlace, countryForIso, isPlaceInRegion } from './countries.ts';
import { labelCountryIso } from './country-label.ts';
import { unlistedCountryNamesRu } from './country-names.ts';
import { offsetPoint, randomPointAround } from './geo.ts';
import { NORTH_MIN_LAT, clipRingNorthOf, getNorthCountries } from './north.ts';
import { ALL_PLACES, placesNear, placesOfIso, settlementRadiusKm } from './places.ts';
import { seededRng } from './rng.ts';
import { getSourceGroups } from './sources.ts';

// Value: protects=a country without an outline has one continent whichever of its places is asked first; fails_when=the first place asked decides, so the Northern Mariana Islands are in Asia after the airports map was opened and in Oceania after the availability table was built;
// why_new=the answer was remembered from the first place asked; seam=none; no_claim=which continent is right for an island group (only that it is one, and that of its biggest settlement). Stays the first test of the file: it asks before any other test has.
test('a country without an outline has one continent whichever place is asked first', () => {
  // The airport of Rota is nearer to an Asian coast than to any of Oceania.
  expect(continentOfPlace('MP', { lat: 14.17, lng: 145.24 })).toBe('oceania');
  expect(continentOfPlace('MP', { lat: 15.12, lng: 145.73 })).toBe('oceania');
  // Kiritimati lies nearer to Hawaii than to any coast of Oceania.
  expect(continentOfPlace('KI', { lat: 1.99, lng: -157.35 })).toBe('oceania');
  expect(continentOfPlace('KI', { lat: 1.38, lng: 173.15 })).toBe('oceania');
});

// Value: protects=a probe near the antimeridian or the pole is still a valid coordinate; fails_when=the offset adds degrees without wrapping the longitude or clamping the latitude;
// why_new=the airports probe added flat degrees and could leave -180..180; seam=none; no_claim=Google's handling of the coordinate (math only)
test('offsetPoint wraps the longitude and keeps the latitude off the pole', () => {
  const east = offsetPoint({ lat: -17.75, lng: 179.99 }, 5, Math.PI / 2);
  expect(east.lng).toBeGreaterThanOrEqual(-180);
  expect(east.lng).toBeLessThan(-179.9);
  expect(haversineDistanceKm({ lat: -17.75, lng: 179.99 }, east)).toBeCloseTo(5, 3);
  const north = offsetPoint({ lat: 89.99, lng: 10 }, 50, 0);
  expect(north.lat).toBeLessThanOrEqual(89.9);
  expect(Math.abs(north.lng)).toBeLessThanOrEqual(180);
  const rng = seededRng(4);
  for (let i = 0; i < 300; i += 1) {
    const centre = { lat: 78 + rng() * 11, lng: 170 + rng() * 20 - (rng() < 0.5 ? 360 : 0) };
    const point = randomPointAround(centre, 30, rng);
    expect(Math.abs(point.lat)).toBeLessThanOrEqual(89.9);
    expect(point.lng).toBeGreaterThanOrEqual(-180);
    expect(point.lng).toBeLessThanOrEqual(180);
  }
});

// Value: protects=points around a centre stay inside the radius, evenly over the disc or leaning to the centre; fails_when=the radius is exceeded or the two spreads are swapped;
// why_new=the helper is new; seam=none; no_claim=nothing beyond the math
test('randomPointAround stays inside the radius in both spreads', () => {
  const rng = seededRng(9);
  const centre = { lat: 48.85, lng: 2.35 };
  let nearEven = 0;
  let nearDisc = 0;
  for (let i = 0; i < 600; i += 1) {
    const even = haversineDistanceKm(centre, randomPointAround(centre, 10, rng, true));
    const disc = haversineDistanceKm(centre, randomPointAround(centre, 10, rng));
    expect(even).toBeLessThanOrEqual(10.01);
    expect(disc).toBeLessThanOrEqual(10.01);
    if (even <= 5) nearEven += 1;
    if (disc <= 5) nearDisc += 1;
  }
  // Half of an even-distance spread is within half the radius; a quarter of an even-area one.
  expect(nearEven / 600).toBeGreaterThan(0.42);
  expect(nearDisc / 600).toBeLessThan(0.33);
});

// Value: protects=a place gets its continent from its country, from the polygon for Russia and France, and from the nearest coast for an island state; fails_when=a point-map place lands in the wrong continent region;
// why_new=point maps had no region before; seam=none; no_claim=disputed or transcontinental cases beyond the listed ones
test('a place knows its continent and its region', () => {
  expect(continentOfPlace('DE', { lat: 52.5, lng: 13.4 })).toBe('europe');
  expect(continentOfPlace('RU', { lat: 55.75, lng: 37.6 })).toBe('europe');
  expect(continentOfPlace('RU', { lat: 56.0, lng: 92.9 })).toBe('asia');
  expect(continentOfPlace('FR', { lat: 4.9, lng: -52.3 })).toBe('south_america');
  expect(continentOfPlace('SG', { lat: 1.35, lng: 103.8 })).toBe('asia');
  expect(continentOfPlace('MT', { lat: 35.9, lng: 14.5 })).toBe('europe');
  expect(continentOfPlace('MU', { lat: -20.2, lng: 57.5 })).toBe('africa');
  // Guam and Palau lie nearer to an Asian coast of the regions dataset, yet belong to Oceania.
  expect(continentOfPlace('GU', { lat: 13.5, lng: 144.8 })).toBe('oceania');
  expect(continentOfPlace('PW', { lat: 7.4, lng: 134.5 })).toBe('oceania');
  const asianAirports = getSourceGroups('airports', 'asia').map((group) => group.iso);
  expect(asianAirports).not.toContain('GU');
  expect(asianAirports).not.toContain('PW');
  expect(getSourceGroups('airports', 'oceania').map((group) => group.iso)).toContain('GU');
  expect(isPlaceInRegion('FR', { lat: 48.85, lng: 2.35 }, 'world')).toBe(true);
  expect(isPlaceInRegion('FR', { lat: 48.85, lng: 2.35 }, 'country:FRA')).toBe(true);
  expect(isPlaceInRegion('FR', { lat: 48.85, lng: 2.35 }, 'country:DEU')).toBe(false);
  expect(isPlaceInRegion('FR', { lat: 4.9, lng: -52.3 }, 'europe')).toBe(false);
  // A country without a polygon is in no one-country region.
  expect(isPlaceInRegion('SG', { lat: 1.35, lng: 103.8 }, 'country:MYS')).toBe(false);
  expect(countryForIso('XK')).toEqual({ id: 'KOS', nameRu: 'Республика Косово' });
});

// Value: protects=the places dataset is sane and the nearest-place lookup finds a city by a point inside it; fails_when=the dataset is cut, the flags are misread or the grid misses a neighbour cell;
// why_new=the places dataset is new; seam=none; no_claim=the accuracy of GeoNames itself
test('the places dataset knows capitals, heights and neighbours', () => {
  expect(ALL_PLACES.length).toBeGreaterThan(30_000);
  expect(ALL_PLACES.filter((place) => place.capital).length).toBeGreaterThan(230);
  const paris = placesOfIso('FR')[0];
  expect(paris?.capital).toBe(true);
  expect(paris?.population ?? 0).toBeGreaterThan(2_000_000);
  const laPaz = placesNear({ lat: -16.5, lng: -68.15 }, 5)[0]?.place;
  expect(laPaz?.iso).toBe('BO');
  expect(laPaz?.elevation ?? 0).toBeGreaterThan(3000);
  // Across the antimeridian: Fiji's towns are found from a point at longitude -179.9.
  expect(placesNear({ lat: -16.8, lng: -179.9 }, 120).some((e) => e.place.iso === 'FJ')).toBe(true);
  expect(settlementRadiusKm(15_000)).toBeCloseTo(1.14, 1);
  expect(settlementRadiusKm(1_000_000)).toBeCloseTo(7.09, 1);
});

// Value: protects=every source of a point map sits in the asked region, with probes its own rule accepts; fails_when=a region filter leaks or a source rejects its own probes;
// why_new=the generic sources are new; seam=none; no_claim=real Street View coverage (no lookups)
test('sources of every point map stay in their region and accept their own probes', () => {
  const rng = seededRng(31);
  for (const map of ['cities', 'megacities', 'capitals', 'airports', 'highlands'] as const) {
    const groups = getSourceGroups(map, 'south_america');
    expect(groups.length).toBeGreaterThan(3);
    for (const group of groups) {
      expect(group.weight).toBeGreaterThan(0);
      const source = group.sources[Math.floor(rng() * group.sources.length)];
      if (!source) throw new Error('empty group');
      expect(isPlaceInRegion(source.iso, source.centre, 'south_america')).toBe(true);
      for (let i = 0; i < 5; i += 1) expect(source.accepts(source.probe(rng))).toBe(true);
    }
  }
  expect(getSourceGroups('highlands', 'europe')).toEqual([]);
  expect(getSourceGroups('megacities', 'country:JPN')[0]?.sources.length).toBe(3);
  // Every country is equally likely on the capitals map, whatever its size.
  expect(new Set(getSourceGroups('capitals', 'world').map((g) => g.weight)).size).toBe(1);
});

// Value: protects=the cities dataset holds real cities with usable outlines, and none in mainland China; fails_when=the dataset is cut, an outline loses its core city or a country without coverage slips in;
// why_new=the cities dataset is new; seam=none; no_claim=the accuracy of the GHSL outlines themselves
test('the cities dataset holds outlines around their core cities', () => {
  expect(URBAN_CENTRES.length).toBeGreaterThan(800);
  expect(URBAN_CENTRES.every((centre) => centre.population >= 500_000)).toBe(true);
  expect(URBAN_CENTRES.some((centre) => centre.iso === 'CN')).toBe(false);
  const moscow = URBAN_CENTRES.find((centre) => centre.name === 'Moscow');
  expect(moscow?.iso).toBe('RU');
  expect(moscow?.rings.some((ring) => pointInRing(37.618, 55.752, ring))).toBe(true);
  for (const centre of URBAN_CENTRES) {
    expect(centre.rings.length).toBeGreaterThan(0);
    expect(centre.rings.every((ring) => ring.length >= 4)).toBe(true);
    const nearCore = centre.rings.some((ring) =>
      ring.some(([lng, lat]) => haversineDistanceKm(centre.core, { lat, lng }) < 80),
    );
    expect(nearCore).toBe(true);
  }
});

// Value: protects=the north map cuts countries at 60 degrees north and keeps only those with land above it; fails_when=the clip keeps southern land or drops a northern country;
// why_new=the north map is new; seam=none; no_claim=real Street View coverage (no lookups)
test('the north map keeps only land north of the sixtieth parallel', () => {
  const square: [number, number][] = [
    [0, 50],
    [10, 50],
    [10, 70],
    [0, 70],
    [0, 50],
  ];
  const clipped = clipRingNorthOf(square, 60);
  expect(clipped.every(([, lat]) => lat >= 60)).toBe(true);
  expect(clipped.length).toBe(5);
  expect(clipRingNorthOf(square, 80)).toEqual([]);
  const world = getNorthCountries('world');
  expect(world.map((entry) => entry.country.id).sort()).toEqual(
    ['CAN', 'FIN', 'GRL', 'ISL', 'NOR', 'RUS', 'SWE', 'USA'].sort(),
  );
  for (const entry of world) {
    expect(entry.polygons.every((poly) => poly.bbox[1] >= NORTH_MIN_LAT)).toBe(true);
    expect(entry.polygons.every((poly) => poly.ring.every(([, lat]) => lat >= 59.999))).toBe(true);
    // The box follows the land: an island wholly north of the line does not start at the line.
    for (const poly of entry.polygons) {
      expect(poly.bbox[1]).toBeCloseTo(Math.min(...poly.ring.map(([, lat]) => lat)), 9);
    }
  }
  const boxes = world.flatMap((entry) => entry.polygons.map((poly) => poly.bbox[1]));
  expect(boxes.some((minLat) => minLat > 70)).toBe(true);
  expect(getNorthCountries('africa')).toEqual([]);
  expect(getNorthCountries('country:FIN').map((entry) => entry.country.id)).toEqual(['FIN']);
  // Played countries are skipped until none is left.
  expect(getNorthCountries('country:FIN', new Set(['FIN'])).length).toBe(1);
  expect(getNorthCountries('europe', new Set(['RUS'])).some((e) => e.country.id === 'RUS')).toBe(
    false,
  );
});

// Value: protects=a panorama across a border is named after the country it stands in when a settlement there is clearly closer; fails_when=the round keeps the airport's country in La Línea or gives Gibraltar's own streets to Spain;
// why_new=the round took the country of the airport whatever the panorama; seam=none; no_claim=borders without a settlement of 15 thousand people nearby
test('a panorama across the border from Gibraltar airport is in Spain', () => {
  const airport = getSourceGroups('airports', 'world')
    .find((group) => group.iso === 'GI')
    ?.sources.at(0);
  if (!airport) throw new Error('Gibraltar airport is missing');
  expect(labelCountryIso(airport, { lat: 36.168, lng: -5.348 })).toBe('ES');
  expect(labelCountryIso(airport, { lat: 36.14, lng: -5.353 })).toBe('GI');
  expect(labelCountryIso(airport, airport.centre)).toBe('GI');
  // Far from any other country the place keeps its own.
  expect(
    labelCountryIso({ iso: 'FR', centre: { lat: 48.85, lng: 2.35 } }, { lat: 48.86, lng: 2.34 }),
  ).toBe('FR');
});

// Value: protects=the list of countries without a polygon names the island and city states the point maps reach; fails_when=a dataset stops feeding the list or a listed country leaks into it;
// why_new=the Detective guard only knew the regions dataset; seam=none; no_claim=the guard's own matching (list only)
test('unlisted country names cover the territories outside the regions dataset', () => {
  const names = unlistedCountryNamesRu();
  expect(names).toContain('Сингапур');
  expect(names).toContain('Мальта');
  expect(names).toContain('Мальдивы');
  expect(names.length).toBeGreaterThan(55);
  const listed = new Set(REGION_COUNTRIES.map((country) => country.nameRu));
  expect(names.filter((name) => listed.has(name))).toEqual([]);
});

// Value: protects=the availability table the lobby reads matches the datasets; fails_when=a dataset is rebuilt without `bun run build:map-availability`;
// why_new=the table is new; seam=none; no_claim=the lobby's use of the table (data only)
test('the committed availability table matches the datasets', () => {
  expect(computeMapAvailability()).toEqual(
    rawAvailability as ReturnType<typeof computeMapAvailability>,
  );
});
