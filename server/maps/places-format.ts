/** Layout of `places.data.json`, shared by its reader and by `scripts/build-places.ts`. */

export const PLACE_FLAG_CAPITAL = 1;
/** A named part of a bigger place (a borough): a settlement, but not a city of its own. */
export const PLACE_FLAG_DISTRICT = 2;
/** Numbers per place in the flat list: latitude, longitude, population, elevation, flags. */
export const PLACE_RECORD_LENGTH = 5;

export interface PlacesDataset {
  version: 1;
  source: string;
  /**
   * ISO 3166-1 alpha-2 code to a flat list, five numbers per place: latitude, longitude,
   * population, elevation in metres, flags. Places are sorted by population, largest first.
   */
  places: Record<string, number[]>;
}
