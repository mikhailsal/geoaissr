import { expect, test } from 'bun:test';
import type { MetadataClient } from '../server/location/metadata.ts';
import { seededRng } from '../server/maps/rng.ts';
import { findCountryAtPoint } from '../shared/regions.ts';
import { MIN_OLD_FOUND, measureCountry, scanRetro, selectRetroCountries } from './scan-retro.ts';

/** A metadata double: every lookup finds a panorama at the probe, old ones only north of 50°. */
function northIsOld(seen: { lat: number; lng: number; radiusM: number }[] = []) {
  const find: MetadataClient['find'] = (pos, radiusM) => {
    seen.push({ ...pos, radiusM });
    return Promise.resolve({
      panoId: `p-${seen.length}`,
      lat: pos.lat,
      lng: pos.lng,
      year: pos.lat > 50 ? 2009 : 2021,
    });
  };
  return { find, seen };
}

// Value: protects=the measurement sends exactly the asked number of lookups into the country, half at settlements and half at open land, like a retro round; fails_when=lookups leave the country or one kind of probe is dropped;
// why_new=the scan is new; seam=none; no_claim=what Google answers (metadata double)
test('a country is measured with town and open-land lookups inside it', async () => {
  const { find, seen } = northIsOld();
  const stat = await measureCountry('EST', 40, find, seededRng(5));
  expect(stat).toEqual({ lookups: 40, old: 40 });
  expect(seen.length).toBe(40);
  expect(seen.filter((probe) => probe.radiusM === 750).length).toBe(20);
  expect(seen.filter((probe) => probe.radiusM === 5000).length).toBe(20);
  const open = seen.filter((probe) => probe.radiusM === 5000);
  expect(open.every((probe) => findCountryAtPoint(probe)?.id === 'EST')).toBe(true);
});

// Value: protects=the second pass goes only to countries where the first one found an old panorama, and the two passes add up; fails_when=every country gets the long pass or the first pass is thrown away;
// why_new=the scan is new; seam=none; no_claim=what Google answers (metadata double)
test('the scan looks closer only where the first pass found an old panorama', async () => {
  const { find } = northIsOld();
  const reported: string[] = [];
  const stats = await scanRetro({
    countryIds: ['EST', 'PRT'],
    find,
    rng: seededRng(6),
    firstPass: 24,
    secondPass: 36,
    onCountry: (id) => reported.push(id),
  });
  expect(stats).toEqual({ EST: { lookups: 60, old: 60 }, PRT: { lookups: 24, old: 0 } });
  expect(reported).toEqual(['EST', 'PRT']);
});

// Value: protects=only countries with enough old panoramas stay on the retro map; fails_when=a country with one lucky lookup is kept and its rounds take hundreds of lookups;
// why_new=the scan is new; seam=none; no_claim=the threshold being right for play (measured separately)
test('a country needs enough old panoramas to stay on the retro map', () => {
  const stats = {
    EST: { lookups: 480, old: 140 },
    NOR: { lookups: 480, old: MIN_OLD_FOUND },
    MEX: { lookups: 480, old: MIN_OLD_FOUND - 1 },
    EGY: { lookups: 120, old: 0 },
  };
  expect(Object.keys(selectRetroCountries(stats))).toEqual(['EST', 'NOR']);
  expect(Object.keys(selectRetroCountries(stats, 100))).toEqual(['EST']);
});
