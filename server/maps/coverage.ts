import type { RegionId } from '../../shared/region-ids.ts';
import { getWeightedCountriesForRegion, type WeightedCountry } from '../../shared/regions.ts';
import rawCoverage from './coverage.data.json' with { type: 'json' };

export interface CoverageKindStat {
  /** Lookups of this kind the measurement sent into the country. */
  lookups: number;
  /** How many of them found an official panorama a round would have taken. */
  found: number;
}

export interface CoverageCountryStat {
  /** Lookups aimed at the country's settlements: what a town round of the standard map sends. */
  town: CoverageKindStat;
  /** Lookups at random points of its land: the wild map and the other half of the standard one. */
  open: CoverageKindStat;
}

/** `coverage.data.json`, written by `bun run scan:coverage`. */
export interface CoverageDataset {
  version: 1;
  /** Month of the measurement. Google keeps adding countries, so the list ages. */
  measured: string;
  /** Every measured country, by id in the regions dataset. */
  countries: Record<string, CoverageCountryStat>;
}

export const COVERAGE_DATASET = rawCoverage as CoverageDataset;

/**
 * A country is playable when at least one lookup in this many finds a panorama. A round gives up
 * after 90 lookups, so a country right at the bar still fails about one round in ten.
 */
export const COVERED_LOOKUPS_PER_FIND = 40;

export type CoverageKind = 'town' | 'open';

export function isCoveredStat(stat: CoverageKindStat | undefined): boolean {
  return (
    stat !== undefined && stat.found > 0 && stat.lookups <= stat.found * COVERED_LOOKUPS_PER_FIND
  );
}

/** Whether lookups of the kind find panoramas in the country often enough for a round. */
export function isCountryCovered(countryId: string, kind: CoverageKind): boolean {
  return isCoveredStat(COVERAGE_DATASET.countries[countryId]?.[kind]);
}

/** Whether a round of the standard map can start in the country: in a town or on open land. */
export function isCountryPlayable(countryId: string): boolean {
  return isCountryCovered(countryId, 'town') || isCountryCovered(countryId, 'open');
}

/**
 * Countries of the region where lookups of the kind find a round, minus those already played;
 * every such country again once all were played. A country without coverage (China, Iran, North
 * Korea) would spend the whole lookup budget of a round and end it with an error.
 */
export function getCoveredCountries(
  region: RegionId,
  kind: CoverageKind,
  excludeCountryIds: ReadonlySet<string> = new Set(),
): WeightedCountry[] {
  const covered = getWeightedCountriesForRegion(region).filter((entry) =>
    isCountryCovered(entry.country.id, kind),
  );
  const open = covered.filter((entry) => !excludeCountryIds.has(entry.country.id));
  return open.length > 0 ? open : covered;
}

/** Under one find in this many lookups a country counts as having no coverage at all. */
export const BARE_LOOKUPS_PER_FIND = 100;

/**
 * Whether the scan looked into the country and found next to nothing: under one panorama in a
 * hundred lookups, towns and open land together. The point maps drop the places of such a
 * country (the airports of mainland China, where one lookup in 480 found a panorama). A country
 * the scan never measured, one without an outline in the regions dataset (Hong Kong, Singapore),
 * keeps its places.
 */
export function isCountryBare(countryId: string): boolean {
  const stat = COVERAGE_DATASET.countries[countryId];
  if (stat === undefined) return false;
  const found = stat.town.found + stat.open.found;
  return found * BARE_LOOKUPS_PER_FIND < stat.town.lookups + stat.open.lookups;
}

/** Countries of the region the standard map can play, and those the wild map can. */
export function countPlayableCountries(region: RegionId, kind: 'any' | 'open'): number {
  return getWeightedCountriesForRegion(region).filter((entry) =>
    kind === 'open'
      ? isCountryCovered(entry.country.id, 'open')
      : isCountryPlayable(entry.country.id),
  ).length;
}
