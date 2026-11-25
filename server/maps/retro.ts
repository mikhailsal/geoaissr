import type { RegionId } from '../../shared/region-ids.ts';
import { getWeightedCountriesForRegion, type WeightedCountry } from '../../shared/regions.ts';
import rawRetro from './retro.data.json' with { type: 'json' };

/** The retro map keeps panoramas shot before this year. */
export const RETRO_BEFORE_YEAR = 2012;

export interface RetroCountryStat {
  /** Lookups the measurement sent into the country. */
  lookups: number;
  /** How many of them found a panorama older than the limit. */
  old: number;
}

/** `retro.data.json`, written by `bun run scan:retro`. */
export interface RetroDataset {
  version: 1;
  /** Month of the measurement. Google keeps replacing old panoramas, so the list ages. */
  measured: string;
  beforeYear: number;
  /** Countries, by id in the regions dataset, where the search still finds old panoramas. */
  countries: Record<string, RetroCountryStat>;
}

export const RETRO_DATASET = rawRetro as RetroDataset;

const cache = new Map<RegionId, WeightedCountry[]>();

/**
 * Countries of the region the retro map can play. Almost everywhere the newest panorama of a
 * road is a recent one, and a round would cost hundreds of lookups; the map keeps to the
 * countries where a measurement found old panoramas often enough.
 */
function retroCountries(region: RegionId): WeightedCountry[] {
  const cached = cache.get(region);
  if (cached) return cached;
  const result: WeightedCountry[] = [];
  for (const entry of getWeightedCountriesForRegion(region)) {
    const stat = RETRO_DATASET.countries[entry.country.id];
    if (!stat || stat.old <= 0) continue;
    // A country where old panoramas are rare gets more of the lookups, so that every listed
    // country comes up about equally often.
    result.push({ ...entry, weight: stat.lookups / stat.old });
  }
  cache.set(region, result);
  return result;
}

/** The same, minus countries already played; every country again once all were played. */
export function getRetroCountries(
  region: RegionId,
  excludeCountryIds: ReadonlySet<string> = new Set(),
): WeightedCountry[] {
  const all = retroCountries(region);
  const open = all.filter((entry) => !excludeCountryIds.has(entry.country.id));
  return open.length > 0 ? open : all;
}
