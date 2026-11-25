import { z } from 'zod';

/** Areas made of several countries: the whole world and the six continents. */
export const AREA_REGION_IDS = [
  'world',
  'europe',
  'asia',
  'north_america',
  'south_america',
  'africa',
  'oceania',
] as const;
export type AreaRegionId = (typeof AREA_REGION_IDS)[number];
export type ContinentId = Exclude<AreaRegionId, 'world'>;

/** One country: the prefix plus the country's id in the regions dataset, e.g. `country:FRA`. */
export type CountryRegionId = `country:${string}`;
export type RegionId = AreaRegionId | CountryRegionId;

const COUNTRY_PREFIX = 'country:';
const COUNTRY_REGION_SHAPE = /^country:[A-Z0-9]{2,8}$/;

export function isAreaRegionId(value: string): value is AreaRegionId {
  return (AREA_REGION_IDS as readonly string[]).includes(value);
}

/**
 * Whether the text has the form of a region id. It does not look the country up: that takes
 * the regions dataset, see `isKnownRegion` in `regions.ts`.
 */
export function isRegionIdShape(value: string): value is RegionId {
  return isAreaRegionId(value) || COUNTRY_REGION_SHAPE.test(value);
}

export function countryRegionId(countryId: string): CountryRegionId {
  return `${COUNTRY_PREFIX}${countryId}`;
}

/** The dataset id of the country a one-country region names, or null for an area. */
export function countryIdOfRegion(region: RegionId): string | null {
  return region.startsWith(COUNTRY_PREFIX) ? region.slice(COUNTRY_PREFIX.length) : null;
}

export const regionIdSchema = z.string().refine(isRegionIdShape, { message: 'Unknown region id' });
