import { expect, test } from 'bun:test';
import type { MetadataClient } from '../server/location/metadata.ts';
import { isCoveredStat } from '../server/maps/coverage.ts';
import { seededRng } from '../server/maps/rng.ts';
import { pickScanCountries, scanCoverage } from './scan-coverage.ts';

/** A metadata double: a town lookup (750 m) finds a panorama at the probe when `townHit` says so. */
function townsOnly(townHit: (n: number) => boolean): MetadataClient['find'] {
  let towns = 0;
  return (pos, radiusM) => {
    if (radiusM !== 750) return Promise.resolve(null);
    towns += 1;
    return Promise.resolve(
      townHit(towns) ? { panoId: `p-${towns}`, lat: pos.lat, lng: pos.lng, year: 2021 } : null,
    );
  };
}

function scanEstonia(townHit: (n: number) => boolean) {
  return scanCoverage({
    countryIds: ['EST'],
    find: townsOnly(townHit),
    rng: seededRng(3),
    firstPass: 48,
    secondPass: 24,
  });
}

// Value: protects=town and open-land lookups are counted apart, and the second pass goes only to
// a country where a kind found a few panoramas; fails_when=the kinds are added up (a country
// covered only in towns would be offered on the wild map) or every country gets the long pass;
// why_new=the scan is new; seam=none; no_claim=what Google answers (metadata double).
test('the scan counts towns and open land apart and looks closer near the bar', async () => {
  expect(await scanEstonia(() => true)).toEqual({
    EST: { town: { lookups: 24, found: 24 }, open: { lookups: 24, found: 0 } },
  });
  expect(await scanEstonia(() => false)).toEqual({
    EST: { town: { lookups: 24, found: 0 }, open: { lookups: 24, found: 0 } },
  });
  // Two finds in the first pass settle nothing: the second pass adds its lookups.
  expect(await scanEstonia((n) => n % 12 === 0)).toEqual({
    EST: { town: { lookups: 36, found: 3 }, open: { lookups: 36, found: 0 } },
  });
});

// Value: protects=the bar a country has to pass to be offered: one find in forty lookups, and
// never on zero finds; fails_when=a country with no panorama, or with one lucky find in hundreds
// of lookups, is offered and its rounds run out of lookups; why_new=the bar is new;
// seam=isCoveredStat (non-test callers: isCountryCovered in coverage.ts); no_claim=that the bar
// suits play (the round budget is 90 lookups).
test('a kind is covered from one find in forty lookups', () => {
  expect(isCoveredStat(undefined)).toBe(false);
  expect(isCoveredStat({ lookups: 120, found: 0 })).toBe(false);
  expect(isCoveredStat({ lookups: 120, found: 2 })).toBe(false);
  expect(isCoveredStat({ lookups: 120, found: 3 })).toBe(true);
  expect(isCoveredStat({ lookups: 360, found: 8 })).toBe(false);
  expect(isCoveredStat({ lookups: 360, found: 9 })).toBe(true);
});

// Value: protects=a scan of some countries cannot replace the tracked coverage dataset;
// fails_when=--only without its own --out is accepted and the lobby loses every other country;
// why_new=the scan is new; seam=none; no_claim=the file write itself (dataset-io test).
test('a partial coverage scan needs its own output file', () => {
  expect(pickScanCountries('EST', '/tmp/part.json')).toEqual(['EST']);
  expect(() => pickScanCountries('EST', undefined)).toThrow('coverage.data.json');
  expect(() => pickScanCountries('EST', 'server/maps/coverage.data.json')).toThrow(
    '--only needs --out',
  );
});
