import { expect, test } from 'bun:test';
import { pointInRing } from '../../shared/regions.ts';
import { haversineDistanceKm, type LatLng } from '../../shared/score.ts';
import { GeoError } from '../errors.ts';
import { URBAN_CENTRES } from '../maps/cities.ts';
import { NORTH_MIN_LAT } from '../maps/north.ts';
import { RETRO_BEFORE_YEAR, RETRO_DATASET } from '../maps/retro.ts';
import { ALL_PLACES, settlementRadiusKm } from '../maps/places.ts';
import {
  HIGHLAND_MIN_ELEVATION_M,
  HIGHLAND_MIN_POPULATION,
  MEGACITY_MIN_POPULATION,
} from '../maps/sources.ts';
import { MAX_TRANSPORT_FAILURES } from './metadata.ts';
import { EmptyMapRegionError } from './service.ts';
import { panoAt, serviceWithDouble } from './test-helpers.ts';

function centreAround(pos: LatLng): (typeof URBAN_CENTRES)[number] | undefined {
  return URBAN_CENTRES.find((centre) =>
    centre.rings.some((ring) => pointInRing(pos.lng, pos.lat, ring)),
  );
}

// Value: protects=a cities round starts inside the dense outline of an urban centre of the region; fails_when=the probe leaves the outline or the region filter is dropped;
// why_new=the cities map is new; seam=none; no_claim=real Street View coverage (metadata double answers at the probe)
test('the cities map starts every round inside the outline of a city of the region', async () => {
  const { svc, requests } = serviceWithDouble({ seed: 21 });
  const played: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    if (i % 5 === 0) played.length = 0;
    const target = await svc.prepareRoundLocation({
      map: 'cities',
      region: 'europe',
      excludeCountryIds: played,
    });
    expect(played).not.toContain(target.countryId);
    played.push(target.countryId);
    const centre = centreAround(target);
    expect(centre).toBeDefined();
    expect(centre?.population ?? 0).toBeGreaterThanOrEqual(500_000);
    expect(target.map).toBe('cities');
  }
  expect(requests.length).toBe(40);
});

// Value: protects=the megacities map holds only centres of five million people or more; fails_when=the population floor is lowered or dropped;
// why_new=the megacities map is new; seam=none; no_claim=real Street View coverage (metadata double)
test('the megacities map only starts in centres of five million people or more', async () => {
  const { svc } = serviceWithDouble({ seed: 22 });
  for (let i = 0; i < 30; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'megacities',
      region: 'world',
      excludeCountryIds: [],
    });
    expect(centreAround(target)?.population ?? 0).toBeGreaterThanOrEqual(MEGACITY_MIN_POPULATION);
  }
});

// Value: protects=rounds in a row do not repeat a city while the map has others; fails_when=the recent-places memory is dropped;
// why_new=no map had repeatable places before; seam=none; no_claim=real Street View coverage (metadata double)
test('three megacity rounds in Japan are three different cities', async () => {
  const { svc } = serviceWithDouble({ seed: 23 });
  const names = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'megacities',
      region: 'country:JPN',
      excludeCountryIds: ['JPN'],
    });
    expect(target.countryId).toBe('JPN');
    names.add(centreAround(target)?.name ?? `missing-${i}`);
  }
  expect([...names].sort()).toEqual(['Nagoya', 'Osaka', 'Tokyo']);
});

function nearestPlace(pos: LatLng, keep: (place: (typeof ALL_PLACES)[number]) => boolean) {
  let best: { place: (typeof ALL_PLACES)[number]; km: number } | undefined;
  for (const place of ALL_PLACES) {
    if (!keep(place)) continue;
    const km = haversineDistanceKm(pos, place);
    if (!best || km < best.km) best = { place, km };
  }
  return best;
}

// Value: protects=a capitals round starts inside a national capital and no country repeats in a match; fails_when=non-capitals join the map or played countries are not skipped;
// why_new=the capitals map is new; seam=none; no_claim=real Street View coverage (metadata double)
test('the capitals map starts every round inside a capital, one country once per match', async () => {
  const { svc } = serviceWithDouble({ seed: 24 });
  const played: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'capitals',
      region: 'world',
      excludeCountryIds: played,
    });
    expect(played).not.toContain(target.countryId);
    played.push(target.countryId);
    const capital = nearestPlace(target, (place) => place.capital);
    expect(capital?.km ?? Infinity).toBeLessThanOrEqual(
      settlementRadiusKm(capital?.place.population ?? 0) + 1,
    );
  }
});

// Value: protects=a one-country capitals match keeps finding the capital after the country was played; fails_when=the exclusion of played countries empties a one-country map;
// why_new=regions were continents only; seam=none; no_claim=real Street View coverage (metadata double)
test('a capitals match in one country plays that capital again and again', async () => {
  const { svc } = serviceWithDouble({ seed: 25 });
  for (let i = 0; i < 4; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'capitals',
      region: 'country:FRA',
      excludeCountryIds: ['FRA'],
    });
    expect(target.countryNameRu).toBe('Франция');
    expect(haversineDistanceKm(target, { lat: 48.853, lng: 2.349 })).toBeLessThan(20);
  }
});

// Value: protects=a highlands round starts in a city of 100 thousand people or more above 2000 m; fails_when=either floor is lowered;
// why_new=the highlands map is new; seam=none; no_claim=real Street View coverage (metadata double)
test('the highlands map starts in big cities above two thousand metres', async () => {
  const { svc } = serviceWithDouble({ seed: 26 });
  for (let i = 0; i < 25; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'highlands',
      region: 'world',
      excludeCountryIds: [],
    });
    const city = nearestPlace(
      target,
      (place) =>
        place.population >= HIGHLAND_MIN_POPULATION && place.elevation >= HIGHLAND_MIN_ELEVATION_M,
    );
    expect(city?.km ?? Infinity).toBeLessThanOrEqual(
      settlementRadiusKm(city?.place.population ?? 0) + 1,
    );
  }
});

// Value: protects=a map with no places in a region fails at once with a message that names both; fails_when=the search spends lookups on an empty combination;
// why_new=empty combinations did not exist; seam=none; no_claim=the lobby check (service only)
test('a map with no places in the region fails without a single lookup', async () => {
  const { svc, requests } = serviceWithDouble();
  const err = await svc
    .prepareRoundLocation({ map: 'highlands', region: 'europe', excludeCountryIds: [] })
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(err).toBeInstanceOf(EmptyMapRegionError);
  expect((err as Error).message).toBe('На карте «Высокогорье» нет мест в регионе «Европа»');
  expect(requests.length).toBe(0);
});

// Value: protects=every round of the north map is at or above 60 degrees north, also when Google snaps south of the line; fails_when=the latitude rule on the panorama is dropped;
// why_new=the north map is new; seam=none; no_claim=real Street View coverage (metadata double)
test('the north map never starts south of the sixtieth parallel', async () => {
  // Every third answer is a panorama south of the line, whatever the probe was.
  const { svc, requests } = serviceWithDouble({
    seed: 27,
    answer: (probe, lookup) =>
      lookup % 3 === 0 ? panoAt({ lat: NORTH_MIN_LAT - 0.2, lng: probe.lng }) : panoAt(probe),
  });
  const played: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    if (i % 5 === 0) played.length = 0;
    const target = await svc.prepareRoundLocation({
      map: 'north',
      region: 'world',
      excludeCountryIds: played,
    });
    played.push(target.countryId);
    expect(target.lat).toBeGreaterThanOrEqual(NORTH_MIN_LAT);
  }
  expect(requests.every((request) => request.probe.lat >= NORTH_MIN_LAT - 0.5)).toBe(true);
});

// Value: protects=the retro map keeps only a panorama shot before 2012, drops one without a date and takes the earliest good answer of a batch; fails_when=the year rule is dropped, an undated panorama passes or a later answer of the batch wins;
// why_new=the retro map is new; seam=none; no_claim=how often Google has an old panorama (metadata double)
test('the retro map waits for a panorama shot before 2012', async () => {
  // A recent panorama, one without a date, one from the first excluded year, then old ones.
  const dates = ['2019-06', null, `${RETRO_BEFORE_YEAR}-01`, '2009-08'];
  const { svc, requests } = serviceWithDouble({
    seed: 28,
    answer: (probe, lookup) => {
      const date = dates[lookup - 1];
      return date === null ? panoAt(probe) : panoAt(probe, { date: date ?? '2010-05' });
    },
  });
  const target = await svc.prepareRoundLocation({
    map: 'retro',
    region: 'world',
    excludeCountryIds: [],
  });
  // The lookups of a batch go out together; the fourth of them is the first old panorama.
  expect(requests.length).toBe(12);
  const fourth = requests[3]?.probe ?? { lat: 0, lng: 0 };
  expect(target.panoId).toBe(panoAt(fourth).pano_id as string);
  expect(target.map).toBe('retro');
  expect(Object.keys(RETRO_DATASET.countries)).toContain(target.countryId);
});

// Value: protects=the retro map plays only the countries of its measured list, each about equally often, and refuses a country outside the list; fails_when=the list is ignored, one country takes most rounds or an unlisted country spends the lookup budget;
// why_new=the retro map is new; seam=none; no_claim=how often Google has an old panorama (metadata double answers every lookup)
test('the retro map keeps to its measured countries and spreads rounds between them', async () => {
  const listed = Object.keys(RETRO_DATASET.countries);
  expect(RETRO_DATASET.beforeYear).toBe(RETRO_BEFORE_YEAR);
  expect(listed.length).toBeGreaterThanOrEqual(15);
  const { svc, requests } = serviceWithDouble({
    seed: 29,
    answer: (probe) => panoAt(probe, { date: '2009-08' }),
  });
  const rounds = new Map<string, number>();
  for (let i = 0; i < 300; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'retro',
      region: 'world',
      excludeCountryIds: [],
    });
    expect(listed).toContain(target.countryId);
    rounds.set(target.countryId, (rounds.get(target.countryId) ?? 0) + 1);
  }
  // Rare countries get more lookups, so none of them takes more than a fifth of the rounds.
  expect(Math.max(...rounds.values())).toBeLessThan(60);
  const sent = requests.length;
  const err = await svc
    .prepareRoundLocation({ map: 'retro', region: 'country:EGY', excludeCountryIds: [] })
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(err).toBeInstanceOf(EmptyMapRegionError);
  expect(requests.length).toBe(sent);
});

// Value: protects=three lookups in a row that never reach Google end the search with GEO_GOOGLE_UNREACHABLE; fails_when=a dead network spends the whole attempt budget;
// why_new=transport failures used to cost one attempt each, 90 in a row; seam=none; no_claim=real network errors (fetch double throws)
test('a dead network ends the search after three lookups', async () => {
  let fetches = 0;
  const { createLocationService } = await import('./service.ts');
  const svc = createLocationService({
    serverKey: 'test-key',
    fetchImpl: () => {
      fetches += 1;
      return Promise.reject(new Error('network down'));
    },
  });
  for (const map of ['wild', 'airports'] as const) {
    fetches = 0;
    const err = await svc
      .prepareRoundLocation({ map, region: 'world', excludeCountryIds: [] })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(GeoError);
    expect((err as GeoError).code).toBe('GEO_GOOGLE_UNREACHABLE');
    // Each lookup tries twice before it counts as failed.
    expect(fetches).toBe(MAX_TRANSPORT_FAILURES * 2);
  }
});
