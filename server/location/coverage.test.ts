import { expect, test } from 'bun:test';
import { findCountryAtPoint } from '../../shared/regions.ts';
import { computeMapAvailability } from '../maps/availability.ts';
import {
  COVERAGE_DATASET,
  getCoveredCountries,
  isCountryBare,
  isCoveredStat,
  isCountryCovered,
  isCountryPlayable,
} from '../maps/coverage.ts';
import { getSourceGroups } from '../maps/sources.ts';
import { createFakeLocationService } from './fake.ts';
import { EmptyMapRegionError } from './service.ts';
import { serviceWithDouble } from './test-helpers.ts';

// Value: protects=the coverage dataset holds a full scan and says what everyone knows about
// Street View: France and Japan are covered, mainland China and North Korea are not;
// fails_when=a partial or empty scan replaces the dataset and the lobby loses its countries, or
// an uncovered country is offered again; why_new=the dataset is new; seam=none;
// no_claim=that every borderline country is on the right side of the bar.
test('the coverage dataset is a full scan with the known covered and bare countries', () => {
  expect(Object.keys(COVERAGE_DATASET.countries).length).toBeGreaterThan(170);
  for (const id of ['FRA', 'JPN', 'USA', 'BRA', 'ZAF', 'AUS']) {
    expect(isCountryCovered(id, 'town')).toBe(true);
    expect(isCountryPlayable(id)).toBe(true);
  }
  for (const id of ['CHN', 'PRK']) {
    expect(isCountryPlayable(id)).toBe(false);
    expect(isCountryBare(id)).toBe(true);
  }
  // A country the scan never measured (no outline in the regions dataset) keeps its places.
  expect(isCountryBare('iso:HK')).toBe(false);
  const asia = getCoveredCountries('asia', 'town').map((entry) => entry.country.id);
  expect(asia).toContain('JPN');
  expect(asia).not.toContain('CHN');
});

// Value: protects=the standard and wild maps refuse a country without coverage before a single
// lookup, and a round of a whole continent never aims at one; fails_when=a round in China spends
// its ninety lookups and ends in the preparation error, or world rounds waste lookups there;
// why_new=these maps took every country before; seam=none; no_claim=real Street View answers
// (metadata double finds a panorama at every probe).
test('rounds of the standard and wild maps keep to countries with coverage', async () => {
  const { svc, requests } = serviceWithDouble({ seed: 31 });
  for (const map of ['standard', 'wild'] as const) {
    const err = await svc
      .prepareRoundLocation({ map, region: 'country:CHN', excludeCountryIds: [] })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(EmptyMapRegionError);
  }
  expect(requests.length).toBe(0);
  for (let i = 0; i < 60; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: i % 2 === 0 ? 'standard' : 'wild',
      region: 'asia',
      excludeCountryIds: [],
    });
    expect(target.countryId).not.toBe('CHN');
    expect(target.countryId).not.toBe('PRK');
  }
  // Open-land probes fall inside the countries they were aimed at: none of them in China.
  const landProbes = requests.filter((request) => request.radius === 5000);
  expect(landProbes.length).toBeGreaterThan(10);
  expect(landProbes.some((request) => findCountryAtPoint(request.probe)?.id === 'CHN')).toBe(false);
});

// Value: protects=the lobby table and the round search agree on the standard and wild maps: a
// region the table offers has a country to play; fails_when=the table is built from another rule
// than the search uses; why_new=the table had no rows for these maps; seam=none;
// no_claim=that the committed table is fresh (maps.test.ts recomputes it).
test('the availability table offers the standard and wild maps where a round can start', () => {
  const table = computeMapAvailability().maps;
  expect(table.standard?.['country:CHN']).toBeUndefined();
  expect(table.standard?.['country:FRA']).toBe(1);
  expect(table.standard?.world).toBe(getPlayableCount());
  expect(table.wild?.world).toBe(getCoveredCountries('world', 'open').length);
});

// Value: protects=a country covered only in its towns (Greenland) or only outside them (Brunei)
// plays the kind it has, and the wild map takes it only with open land; fails_when=a round there
// aims at the kind without panoramas and spends its lookups, or the wild map offers Greenland;
// why_new=only fully covered and bare countries were tested; seam=none; no_claim=that the two
// countries stay one-sided in a later scan (the first two lines check it).
test('a country covered in one kind plays that kind', async () => {
  expect([isCountryCovered('GRL', 'town'), isCountryCovered('GRL', 'open')]).toEqual([true, false]);
  expect([isCountryCovered('BRN', 'town'), isCountryCovered('BRN', 'open')]).toEqual([false, true]);
  const { svc, requests } = serviceWithDouble({ seed: 7 });
  const prepare = (map: 'standard' | 'wild', region: 'country:GRL' | 'country:BRN') =>
    svc.prepareRoundLocation({ map, region, excludeCountryIds: [] }).then(
      (target) => target.countryId,
      (e: unknown) => e,
    );
  for (let i = 0; i < 8; i += 1) {
    expect(await prepare('standard', 'country:GRL')).toBe('GRL');
  }
  // Every Greenland lookup aimed at a settlement: none used the open-land radius.
  expect(requests.some((request) => request.radius === 5000)).toBe(false);
  expect(await prepare('wild', 'country:GRL')).toBeInstanceOf(EmptyMapRegionError);
  for (let i = 0; i < 8; i += 1) {
    expect(await prepare('standard', 'country:BRN')).toBe('BRN');
  }
  expect(await prepare('wild', 'country:BRN')).toBe('BRN');
});

// Value: protects=a standard round goes to a country not yet played while one is left, whichever
// kind covers it; fails_when=with every open-land country of North America played, an open round
// repeats Canada although Greenland (towns only) is fresh; why_new=each kind fell back to all its
// countries on its own; seam=none; no_claim=the order of countries inside a kind.
test('a standard round prefers the kind that still has a fresh country', async () => {
  const playedLand = getCoveredCountries('north_america', 'open').map((e) => e.country.id);
  expect(playedLand).not.toContain('GRL');
  const { svc } = serviceWithDouble({ seed: 11 });
  for (let i = 0; i < 12; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'standard',
      region: 'north_america',
      excludeCountryIds: playedLand,
    });
    expect(target.countryId).toBe('GRL');
  }
});

// Value: protects=the fake location service keeps the standard and wild maps to covered countries
// like the live one; fails_when=a fake round of Africa lands in Cairo, a country the lobby does
// not offer; why_new=the fake service checked the region only; seam=none; no_claim=live lookups.
test('fake rounds of the standard and wild maps keep to covered countries', async () => {
  const fake = createFakeLocationService();
  for (const map of ['standard', 'wild'] as const) {
    for (let i = 0; i < 6; i += 1) {
      const target = await fake.prepareRoundLocation({
        map,
        region: 'africa',
        excludeCountryIds: [],
      });
      expect(isCountryCovered(target.countryId, map === 'wild' ? 'open' : 'town')).toBe(true);
    }
  }
});

// Value: protects=the point maps aim at no place in a country the scan found bare, and keep the
// places of covered ones; fails_when=the filter is dropped and Beijing is a capital round again,
// or it drops a covered country; why_new=only the rule was tested, not the filtered sources;
// seam=none; no_claim=that a single place inside a thinly covered country has no panorama.
test('the point maps leave out the places of bare countries', () => {
  for (const map of ['capitals', 'airports', 'megacities'] as const) {
    const isos = getSourceGroups(map, 'asia').map((group) => group.iso);
    expect(isos).toContain('JP');
    for (const bare of ['CN', 'KP', 'IR', 'PK']) expect(isos).not.toContain(bare);
  }
});

// Value: protects=the bar of one find in forty lookups, in the direction the round budget needs;
// fails_when=the comparison flips and thin countries pass, or a country with no finds passes;
// why_new=the dataset test names countries far from the bar; seam=none; no_claim=none beyond
// protects.
test('a country is covered from one find in forty lookups', () => {
  expect(isCoveredStat({ lookups: 40, found: 1 })).toBe(true);
  expect(isCoveredStat({ lookups: 41, found: 1 })).toBe(false);
  expect(isCoveredStat({ lookups: 120, found: 0 })).toBe(false);
  expect(isCoveredStat(undefined)).toBe(false);
});

function getPlayableCount(): number {
  return Object.keys(COVERAGE_DATASET.countries).filter(isCountryPlayable).length;
}
