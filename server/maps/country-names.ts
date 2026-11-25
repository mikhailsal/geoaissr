import { AIRPORTS_BY_ISO } from './airports.ts';
import { URBAN_CENTRES } from './cities.ts';
import { ISO_ID_PREFIX, countryForIso } from './countries.ts';
import { placeIsoCodes } from './places.ts';

/**
 * Russian names of the countries and territories a round can be in that have no polygon in the
 * regions dataset: island states, city states, overseas territories. The point maps reach them,
 * so whoever lists country names must add these to the names of the regions dataset.
 */
export function unlistedCountryNamesRu(): string[] {
  const codes = new Set([
    ...Object.keys(AIRPORTS_BY_ISO),
    ...placeIsoCodes(),
    ...URBAN_CENTRES.map((centre) => centre.iso),
  ]);
  const names: string[] = [];
  for (const iso of [...codes].sort()) {
    const country = countryForIso(iso);
    // An ISO code the runtime has no Russian name for comes back as the code itself.
    if (country.id.startsWith(ISO_ID_PREFIX) && country.nameRu !== iso) names.push(country.nameRu);
  }
  return names;
}
