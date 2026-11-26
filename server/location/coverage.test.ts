import { expect, test } from 'bun:test';
import { findCountryAtPoint } from '../../shared/regions.ts';
import { computeMapAvailability } from '../maps/availability.ts';
import {
  COVERAGE_DATASET,
  getCoveredCountries,
  isCountryBare,
  isCountryCovered,
  isCountryPlayable,
} from '../maps/coverage.ts';
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

function getPlayableCount(): number {
  return Object.keys(COVERAGE_DATASET.countries).filter(isCountryPlayable).length;
}
