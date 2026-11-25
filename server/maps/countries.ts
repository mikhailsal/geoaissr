import type { ContinentId, RegionId } from '../../shared/region-ids.ts';
import { countryIdOfRegion, isAreaRegionId } from '../../shared/region-ids.ts';
import { REGION_COUNTRIES, pointInRing, type RegionCountry } from '../../shared/regions.ts';
import { haversineDistanceKm, type LatLng } from '../../shared/score.ts';

/** Prefix of a country id for a country that has no polygon in the regions dataset. */
export const ISO_ID_PREFIX = 'iso:';

const REGION_COUNTRY_BY_ISO = new Map(REGION_COUNTRIES.map((country) => [country.iso, country]));

export interface MapCountry {
  id: string;
  nameRu: string;
}

function isoCountryNameRu(iso: string): string {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

/**
 * The country of a place, from the ISO code its dataset gives it. The regions polygons are too
 * coarse for this: they have no shape for about 60 small countries and put Copenhagen in Sweden.
 * A country the regions dataset knows keeps its id and name from there, so a match that mixes
 * maps still sees one country as one id.
 */
export function countryForIso(iso: string): MapCountry {
  const known = REGION_COUNTRY_BY_ISO.get(iso);
  if (known) return { id: known.id, nameRu: known.nameRu };
  return { id: `${ISO_ID_PREFIX}${iso}`, nameRu: isoCountryNameRu(iso) };
}

/** ISO codes of countries already played, from polygon country ids and `iso:` fallback ids. */
export function isoCodesOfCountryIds(countryIds: Iterable<string>): Set<string> {
  const ids = new Set(countryIds);
  const codes = new Set<string>();
  for (const id of ids) {
    if (id.startsWith(ISO_ID_PREFIX)) codes.add(id.slice(ISO_ID_PREFIX.length));
  }
  for (const country of REGION_COUNTRIES) {
    if (ids.has(country.id)) codes.add(country.iso);
  }
  return codes;
}

/** Islands of Oceania whose nearest coast in the regions dataset is an Asian one. */
const OCEANIA_ISO = new Set(['GU', 'PW']);

const unlistedContinents = new Map<string, ContinentId>();

function nearestPolygonContinent(countries: readonly RegionCountry[], pos: LatLng): ContinentId {
  let best: ContinentId = 'europe';
  let bestKm = Infinity;
  for (const country of countries) {
    for (const poly of country.polygons) {
      if (pointInRing(pos.lng, pos.lat, poly.ring)) return poly.region;
      for (const [lng, lat] of poly.ring) {
        const km = haversineDistanceKm(pos, { lat, lng });
        if (km < bestKm) {
          bestKm = km;
          best = poly.region;
        }
      }
    }
  }
  return best;
}

/**
 * The continent of a place. A country that lies on one continent answers by its ISO code alone;
 * Russia and France span two, so the polygon decides. A country without polygons (an island
 * state, a city state) takes the continent of the nearest coast, except Guam and Palau.
 */
export function continentOfPlace(iso: string, pos: LatLng): ContinentId {
  const country = REGION_COUNTRY_BY_ISO.get(iso);
  if (!country) {
    if (OCEANIA_ISO.has(iso)) return 'oceania';
    // Small enough to sit on one continent, so the first place answers for the whole country.
    const known = unlistedContinents.get(iso);
    if (known) return known;
    const found = nearestPolygonContinent(REGION_COUNTRIES, pos);
    unlistedContinents.set(iso, found);
    return found;
  }
  const first = country.polygons[0]?.region ?? 'europe';
  if (country.polygons.every((poly) => poly.region === first)) return first;
  return nearestPolygonContinent([country], pos);
}

/** Whether a place of the given country lies inside the region. */
export function isPlaceInRegion(iso: string, pos: LatLng, region: RegionId): boolean {
  if (region === 'world') return true;
  if (isAreaRegionId(region)) return continentOfPlace(iso, pos) === region;
  return REGION_COUNTRY_BY_ISO.get(iso)?.id === countryIdOfRegion(region);
}
