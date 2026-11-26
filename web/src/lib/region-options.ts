import { isMapAvailable } from '../../../shared/map-availability';
import type { MapId } from '../../../shared/maps';
import { AREA_REGION_IDS, type RegionId } from '../../../shared/region-ids';
import { AREA_REGION_LABELS_RU, listCountryRegions } from '../../../shared/regions';

export interface RegionOption {
  region: RegionId;
  label: string;
  kind: 'area' | 'country';
  /** Whether the map has places in the region; an option that has none cannot be picked. */
  available: boolean;
}

const COUNTRY_REGIONS = listCountryRegions();

/**
 * The regions the picker offers for a map. Every area is listed, greyed out when the map has no
 * places there. Of the countries only those the map can play are listed: the rest (a country
 * without Street View coverage, a country the map does not reach) would be two hundred dead rows.
 * The chosen region is always listed, so a saved choice the map lost still shows what it is.
 */
export function listRegionOptions(map: MapId, current: RegionId): RegionOption[] {
  const areas = AREA_REGION_IDS.map((region): RegionOption => ({
    region,
    label: AREA_REGION_LABELS_RU[region],
    kind: 'area',
    available: isMapAvailable(map, region),
  }));
  const countries = COUNTRY_REGIONS.map((country): RegionOption => ({
    region: country.region,
    label: country.nameRu,
    kind: 'country',
    available: isMapAvailable(map, country.region),
  })).filter((option) => option.available || option.region === current);
  return [...areas, ...countries];
}

/** Lower case, «ё» as «е», outer spaces dropped: what a typed query and a name are compared by. */
export function normalizeSearch(text: string): string {
  return text.trim().toLowerCase().replaceAll('ё', 'е');
}

/**
 * The options whose name contains the typed text; names that start with it come first. A word
 * inside a name counts as a start too, so «корея» finds «Южная Корея» ahead of a mere substring.
 */
export function filterRegionOptions(
  options: readonly RegionOption[],
  query: string,
): RegionOption[] {
  const needle = normalizeSearch(query);
  if (needle === '') return [...options];
  const starts: RegionOption[] = [];
  const contains: RegionOption[] = [];
  for (const option of options) {
    const name = normalizeSearch(option.label);
    if (!name.includes(needle)) continue;
    const atWordStart = name.split(/[\s-]+/).some((word) => word.startsWith(needle));
    (atWordStart ? starts : contains).push(option);
  }
  return [...starts, ...contains];
}
