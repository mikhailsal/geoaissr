import { expect, test } from 'bun:test';
import { isMapAvailable } from '../../shared/map-availability.ts';
import { MAP_IDS } from '../../shared/maps.ts';
import { AREA_REGION_IDS, type RegionId } from '../../shared/region-ids.ts';
import { NORTH_MIN_LAT } from '../maps/north.ts';
import { createFakeLocationService } from './fake.ts';
import { EmptyMapRegionError } from './service.ts';

// Value: protects=the first rounds of a fake standard match are the drawn scenes in their fixed order; fails_when=the scene order or their countries change;
// why_new=the scenes moved to their own module and got real country ids; seam=none; no_claim=the canvas drawing of a scene (server only)
test('a fake standard match starts in Moscow, then Paris, then Tokyo', async () => {
  const fake = createFakeLocationService();
  const played: string[] = [];
  const seen: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const target = await fake.prepareRoundLocation({
      map: 'standard',
      region: 'world',
      excludeCountryIds: played,
    });
    played.push(target.countryId);
    seen.push(`${target.panoId}:${target.countryId}:${target.fakeSceneIndex}`);
  }
  expect(seen).toEqual(['fake-moscow:RUS:0', 'fake-paris:FRA:1', 'fake-tokyo:JPN:2']);
});

// Value: protects=the fake mode honours a continent and a one-country region on the standard map; fails_when=the region is ignored and a scene of another continent is played;
// why_new=the fake service only looked at the world region; seam=none; no_claim=live sampling (fake service only)
test('a fake standard round stays inside the chosen region', async () => {
  const fake = createFakeLocationService();
  const asia = await fake.prepareRoundLocation({
    map: 'standard',
    region: 'asia',
    excludeCountryIds: [],
  });
  expect(asia.panoId).toBe('fake-tokyo');
  const chile = await fake.prepareRoundLocation({
    map: 'wild',
    region: 'country:CHL',
    excludeCountryIds: ['CHL'],
  });
  expect(chile.countryId).toBe('CHL');
  expect(chile.countryNameRu).toBe('Чили');
  expect(chile.lat).toBeLessThan(-17);
});

const SAMPLE_REGIONS: readonly RegionId[] = [...AREA_REGION_IDS, 'country:FRA', 'country:MEX'];

// Value: protects=every map and region the lobby offers gives a fake round inside that region, and an empty combination is refused; fails_when=a map ignores the region in fake mode or an empty combination returns a made-up place;
// why_new=the fake mode knew one map; seam=none; no_claim=live sampling (fake service only)
test('every available map and region gives a fake round inside the region', async () => {
  const fake = createFakeLocationService();
  for (const map of MAP_IDS) {
    for (const region of SAMPLE_REGIONS) {
      const outcome = await fake
        .prepareRoundLocation({ map, region, excludeCountryIds: [] })
        .catch((err: unknown) => err);
      if (!isMapAvailable(map, region)) {
        expect(outcome).toBeInstanceOf(EmptyMapRegionError);
        continue;
      }
      if (outcome instanceof Error) throw outcome;
      const target = outcome as Awaited<ReturnType<typeof fake.prepareRoundLocation>>;
      expect(target.map).toBe(map);
      expect(target.region).toBe(region);
      expect(target.countryNameRu.length).toBeGreaterThan(0);
      if (map === 'north') expect(target.lat).toBeGreaterThanOrEqual(NORTH_MIN_LAT);
      if (region === 'country:FRA') expect(target.countryId).toBe('FRA');
      if (region === 'country:MEX') expect(target.countryId).toBe('MEX');
    }
  }
});

// Value: protects=a fake point-map match skips countries already played; fails_when=the exclusion list is ignored in fake mode;
// why_new=the fake airports rounds were the fixed scenes; seam=none; no_claim=live sampling (fake service only)
test('a fake capitals match does not repeat a country', async () => {
  const fake = createFakeLocationService();
  const played: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const target = await fake.prepareRoundLocation({
      map: 'capitals',
      region: 'europe',
      excludeCountryIds: played,
    });
    expect(played).not.toContain(target.countryId);
    played.push(target.countryId);
    expect(target.panoId.startsWith('fake-')).toBe(true);
  }
});
