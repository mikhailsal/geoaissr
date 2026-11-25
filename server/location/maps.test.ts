import { expect, test } from 'bun:test';
import { countryRegionId } from '../../shared/region-ids.ts';
import {
  getWeightedCountriesForRegion,
  pointInRing,
  polygonsInRegion,
} from '../../shared/regions.ts';
import { haversineDistanceKm, type LatLng } from '../../shared/score.ts';
import { GeoError } from '../errors.ts';
import { URBAN_CENTRES } from '../maps/cities.ts';
import { NORTH_MIN_LAT } from '../maps/north.ts';
import { RETRO_BEFORE_YEAR, RETRO_DATASET, getRetroCountries } from '../maps/retro.ts';
import { ALL_PLACES, settlementRadiusKm } from '../maps/places.ts';
import {
  HIGHLAND_MIN_ELEVATION_M,
  HIGHLAND_MIN_POPULATION,
  MEGACITY_MIN_POPULATION,
} from '../maps/sources.ts';
import { seededRng } from '../maps/rng.ts';
import { MAX_TRANSPORT_FAILURES } from './metadata.ts';
import { createRecentPlaces, townRoll } from './rolls.ts';
import { EmptyMapRegionError, FRESH_ONLY_SHARE, OPEN_LAND_RADIUS_M } from './service.ts';
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

/** Lookups a round of the default budget keeps to countries and places not played yet. */
const FRESH_ONLY_LOOKUPS = Math.ceil(90 * FRESH_ONLY_SHARE);

// Value: protects=a round goes back to a place played lately when the places not played yet have no panorama; fails_when=the round spends its whole budget on places without a panorama and the match stops at a round a retry cannot save;
// why_new=a place played lately was closed for as long as any other place was left; seam=none; no_claim=which real places lack a panorama (metadata double answers only around Tokyo)
test('a round returns to a played city when the others have no panorama', async () => {
  const tokyo = URBAN_CENTRES.find((centre) => centre.name === 'Tokyo');
  if (!tokyo) throw new Error('the cities dataset has no Tokyo');
  const { svc, requests } = serviceWithDouble({
    seed: 24,
    answer: (probe) =>
      haversineDistanceKm(probe, tokyo.core) < 150 ? panoAt(probe) : { status: 'ZERO_RESULTS' },
  });
  const ask = () =>
    svc.prepareRoundLocation({
      map: 'megacities',
      region: 'country:JPN',
      excludeCountryIds: ['JPN'],
    });
  expect(centreAround(await ask())?.name).toBe('Tokyo');
  const sentBefore = requests.length;
  // Osaka and Nagoya are fresh and empty: the round keeps to them first, then takes Tokyo again.
  expect(centreAround(await ask())?.name).toBe('Tokyo');
  const spent = requests.length - sentBefore;
  expect(spent).toBeGreaterThan(FRESH_ONLY_LOOKUPS);
  expect(spent).toBeLessThan(90);
});

// Value: protects=a round goes back to a country the match has played when the countries not played yet have no panorama; fails_when=the round spends its whole budget in countries without coverage, and a retry with the same played countries cannot save the match;
// why_new=a played country stayed closed for as long as the map had any other country; seam=none; no_claim=which real countries lack coverage (metadata double answers only east of Australia)
test('a round returns to a played country when the others have no panorama', async () => {
  // The cities of Oceania are five in Australia and Auckland; here Australia has no panorama.
  const { svc, requests } = serviceWithDouble({
    seed: 33,
    answer: (probe) => (probe.lng > 160 ? panoAt(probe) : { status: 'ZERO_RESULTS' }),
  });
  const target = await svc.prepareRoundLocation({
    map: 'cities',
    region: 'oceania',
    excludeCountryIds: ['NZL'],
  });
  expect(target.countryId).toBe('NZL');
  expect(requests.length).toBeGreaterThan(FRESH_ONLY_LOOKUPS);
  expect(requests.length).toBeLessThan(90);
  expect(requests.slice(0, FRESH_ONLY_LOOKUPS).every(({ probe }) => probe.lng < 160)).toBe(true);
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

// Value: protects=a one-country match in an enclave finds its rounds at random points; fails_when=every random point of Lesotho resolves to South Africa around it and is refused, so the match never gets a round on «Глушь»;
// why_new=one-country regions are new, and the outlines have no hole for an enclave; seam=none; no_claim=real Street View coverage (metadata double answers at the probe)
test('a wild match in Lesotho finds its rounds in Lesotho', async () => {
  const { svc, requests } = serviceWithDouble({ seed: 35 });
  for (let round = 1; round <= 5; round += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'wild',
      region: 'country:LSO',
      excludeCountryIds: ['LSO'],
    });
    expect(target.countryId).toBe('LSO');
    expect(requests.length).toBe(round);
  }
});

// Value: protects=a round keeps its choice between a settlement and open land when the search reopens the played countries; fails_when=the second phase of the search flips the coin again, so a round that drew open land turns into a town round after its first third and the half-and-half mix of «Стандарт» leans to whichever kind is found sooner;
// why_new=the two-phase search is new; seam=none; no_claim=which of the two a seed draws (only that it holds for the round)
test('a round keeps its choice of town or open land through the whole search', async () => {
  const kinds = new Set<boolean>();
  for (let seed = 1; seed <= 8; seed += 1) {
    const { svc, requests } = serviceWithDouble({
      seed,
      answer: () => ({ status: 'ZERO_RESULTS' }),
    });
    const failure = await svc
      .prepareRoundLocation({ map: 'standard', region: 'country:JPN', excludeCountryIds: [] })
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(String(failure)).toContain('90 попыток');
    expect(requests.length).toBe(90);
    const openLand = requests.map((request) => request.radius === OPEN_LAND_RADIUS_M);
    expect(new Set(openLand).size).toBe(1);
    kinds.add(openLand[0] === true);
  }
  // Both kinds of round were drawn, so the check above did not pass on one kind alone.
  expect(kinds.size).toBe(2);
});

// Value: protects=a town lookup of a country that has no settlement in the region stays on the land of that country; fails_when=the fallback picks a country anew, so French Guiana's share of the South America rounds goes to Brazil;
// why_new=the fallback ran the land roll over every country of the region; seam=none; no_claim=real Street View coverage (the double finds nothing)
test('a town lookup of a country without settlements stays on its own land', async () => {
  const countries = getWeightedCountriesForRegion('south_america');
  const guiana = countries.find((entry) => entry.country.id === 'FRA')?.polygons ?? [];
  expect(guiana.length).toBeGreaterThan(0);
  const probes: { pos: LatLng; radiusM: number }[] = [];
  const roll = townRoll(
    {
      map: 'standard',
      region: 'south_america',
      rng: seededRng(9),
      find: (pos, radiusM) => {
        probes.push({ pos, radiusM });
        return Promise.resolve(null);
      },
      exclude: new Set(),
      recent: createRecentPlaces(),
    },
    countries,
    { landRadiusM: OPEN_LAND_RADIUS_M },
  );
  for (let i = 0; i < 1500; i += 1) await roll();
  const onLand = probes.filter((probe) => probe.radiusM === OPEN_LAND_RADIUS_M);
  expect(onLand.length).toBeGreaterThan(3);
  for (const { pos } of onLand) {
    expect(guiana.some((poly) => pointInRing(pos.lng, pos.lat, poly.ring))).toBe(true);
  }
});

// Value: protects=a north round in Europe is not taken from the Asian side of Russia, where a lookup near the Urals can snap; fails_when=a panorama of a played region's neighbour continent passes because its country is in the region;
// why_new=a random point checked the country of the panorama, not its continent; seam=none; no_claim=where Google really snaps (metadata double answers east of the Urals first)
test('a north round in Europe refuses a panorama on the Asian side of Russia', async () => {
  const asianSide = { lat: 61, lng: 60.5 };
  // Both kinds of round, a settlement and a random point, come up among these seeds.
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const { svc, requests } = serviceWithDouble({
      seed,
      answer: (probe, lookup) => panoAt(lookup === 1 ? asianSide : probe),
    });
    const target = await svc.prepareRoundLocation({
      map: 'north',
      region: 'europe',
      excludeCountryIds: [],
    });
    expect(requests.length).toBe(2);
    expect(target.panoId).toBe(panoAt(requests[1]?.probe ?? asianSide).pano_id as string);
  }
});

// Value: protects=a retro round looks both in the settlements of a country and outside them, the way its measurement did; fails_when=a round decides once to look only outside settlements and spends hundreds of lookups where the old panoramas are all in towns;
// why_new=a retro round kept one kind of place for all its lookups; seam=none; no_claim=where the old panoramas really are (metadata double answers only inside settlements)
test('a retro round finds an old panorama that only the settlements have', async () => {
  const entries = Object.entries(RETRO_DATASET.countries);
  const [strongest] = entries.sort(([, a], [, b]) => b.old / b.lookups - a.old / a.lookups);
  const country = getRetroCountries('world').find((entry) => entry.country.id === strongest?.[0]);
  if (!country) throw new Error('the retro dataset is empty');
  const towns = ALL_PLACES.filter((place) => place.iso === country.country.iso);
  const { svc, requests } = serviceWithDouble({
    seed: 34,
    answer: (probe) =>
      towns.some((town) => haversineDistanceKm(probe, town) <= settlementRadiusKm(town.population))
        ? panoAt(probe, { date: '2009-08' })
        : { status: 'ZERO_RESULTS' },
  });
  for (let round = 1; round <= 8; round += 1) {
    await svc.prepareRoundLocation({
      map: 'retro',
      region: `country:${country.country.id}`,
      excludeCountryIds: [],
    });
    // Two batches of twelve lookups at most for every round so far.
    expect(requests.length).toBeLessThanOrEqual(round * 24);
  }
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

// Value: protects=the retro map plays a country only on the land its measurement covered; fails_when=France joins the retro map in South America through French Guiana, where no old panorama was measured, and a round sent there spends 600 lookups;
// why_new=the retro map took every polygon of a measured country; seam=none; no_claim=which lands really have old panoramas (metadata double answers every lookup)
test('the retro map leaves an overseas part of a measured country out', async () => {
  const world = getRetroCountries('world');
  for (const entry of world) {
    const home = polygonsInRegion(entry.country, countryRegionId(entry.country.id));
    expect(entry.polygons.every((poly) => home.includes(poly))).toBe(true);
  }
  const france = world.find((entry) => entry.country.id === 'FRA');
  expect(france === undefined || france.polygons.every((poly) => poly.region === 'europe')).toBe(
    true,
  );
  expect(getRetroCountries('south_america').map((entry) => entry.country.id)).not.toContain('FRA');
  const { svc, requests } = serviceWithDouble({
    seed: 31,
    answer: (probe) => panoAt(probe, { date: '2009-08' }),
  });
  for (let i = 0; i < 200; i += 1) {
    await svc.prepareRoundLocation({ map: 'retro', region: 'world', excludeCountryIds: [] });
  }
  // No lookup of the two hundred rounds went to French Guiana.
  const inGuiana = requests.filter(
    ({ probe }) => probe.lat > 2 && probe.lat < 6 && probe.lng > -55 && probe.lng < -51.5,
  );
  expect(inGuiana).toEqual([]);
});

// Value: protects=a retro round keeps the place one lookup of a batch found when other lookups of the same batch never reached Google; fails_when=three failed lookups of a batch throw the found round away with GEO_GOOGLE_UNREACHABLE;
// why_new=the lookups of a batch were awaited all-or-nothing; seam=none; no_claim=real network errors (the metadata double throws)
test('a retro batch keeps its place when three of its lookups fail in transit', async () => {
  const { svc, requests } = serviceWithDouble({
    seed: 32,
    // The first three lookups fail twice each (a lookup tries twice); the rest find old panoramas.
    answer: (probe, lookup) => {
      if (lookup <= MAX_TRANSPORT_FAILURES * 2) throw new Error('network down');
      return panoAt(probe, { date: '2009-08' });
    },
  });
  const target = await svc.prepareRoundLocation({
    map: 'retro',
    region: 'world',
    excludeCountryIds: [],
  });
  const firstFound = requests[MAX_TRANSPORT_FAILURES * 2]?.probe ?? { lat: 0, lng: 0 };
  expect(target.panoId).toBe(panoAt(firstFound).pano_id as string);
  expect(requests.length).toBe(MAX_TRANSPORT_FAILURES * 2 + 9);
});

// Value: protects=a spent quota ahead of the place a batch found still stops the round with GEO_GOOGLE_QUOTA; fails_when=the batch takes the place and hides the quota error from the host, who learns of it a round later;
// why_new=the lookups of a retro batch go out together and the earliest hit won over every failure; seam=none; no_claim=Google's real quota replies (the metadata double answers OVER_QUERY_LIMIT)
test('a retro batch stops on a spent quota that comes before its place', async () => {
  const { svc } = serviceWithDouble({
    seed: 32,
    answer: (probe, lookup) =>
      lookup === 1 ? { status: 'OVER_QUERY_LIMIT' } : panoAt(probe, { date: '2009-08' }),
  });
  const err = await svc
    .prepareRoundLocation({ map: 'retro', region: 'world', excludeCountryIds: [] })
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(err).toBeInstanceOf(GeoError);
  expect((err as GeoError).code).toBe('GEO_GOOGLE_QUOTA');
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
