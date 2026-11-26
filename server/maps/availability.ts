import type { MapAvailabilityDataset } from '../../shared/map-availability.ts';
import { AREA_REGION_IDS, countryRegionId, type RegionId } from '../../shared/region-ids.ts';
import { REGION_COUNTRIES } from '../../shared/regions.ts';
import { countPlayableCountries } from './coverage.ts';
import { getNorthCountries } from './north.ts';
import { getRetroCountries } from './retro.ts';
import { SOURCE_MAP_IDS, getSourceGroups } from './sources.ts';

function everyRegion(): RegionId[] {
  return [...AREA_REGION_IDS, ...REGION_COUNTRIES.map((country) => countryRegionId(country.id))];
}

function tableOf(count: (region: RegionId) => number): Record<string, number> {
  const table: Record<string, number> = {};
  for (const region of everyRegion()) {
    const n = count(region);
    if (n > 0) table[region] = n;
  }
  return table;
}

/**
 * Counts the places of every limited map in every region: the table behind
 * `shared/map-availability.data.json`. Point maps count their places, the north and retro maps
 * their countries, and so do the standard and wild maps: the countries where the coverage scan
 * found panoramas (`coverage.data.json`).
 */
export function computeMapAvailability(): MapAvailabilityDataset {
  const maps: MapAvailabilityDataset['maps'] = {};
  for (const map of SOURCE_MAP_IDS) {
    maps[map] = tableOf((region) =>
      getSourceGroups(map, region).reduce((sum, group) => sum + group.sources.length, 0),
    );
  }
  maps.standard = tableOf((region) => countPlayableCountries(region, 'any'));
  maps.wild = tableOf((region) => countPlayableCountries(region, 'open'));
  maps.north = tableOf((region) => getNorthCountries(region).length);
  maps.retro = tableOf((region) => getRetroCountries(region).length);
  return { version: 1, maps };
}
