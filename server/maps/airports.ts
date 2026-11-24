import { REGION_COUNTRIES, sampleWeightedItem } from '../../shared/regions.ts';
import { haversineDistanceKm, type LatLng } from '../../shared/score.ts';
import rawData from './airports.data.json' with { type: 'json' };

/** A round on the airports map starts within this distance of an airport's reference point. */
export const AIRPORT_ZONE_KM = 5;
/** Search radius around the probe point; keeps the found panorama close to where we aimed. */
export const AIRPORT_SNAP_RADIUS_M = 600;

/** Prefix of a country id for an airport whose country has no polygon in the regions dataset. */
const ISO_ID_PREFIX = 'iso:';
const KM_PER_DEGREE = 111.32;

interface RawAirportsDataset {
  version: number;
  source: string;
  airports: Record<string, number[][]>;
}

export interface AirportCountryGroup {
  iso: string;
  airports: readonly (readonly [number, number])[];
  weight: number;
}

export interface AirportProbe {
  iso: string;
  airport: LatLng;
  /** Where to look for a panorama: a random point inside the airport's zone. */
  probe: LatLng;
}

const AIRPORTS_BY_ISO: Readonly<Record<string, readonly (readonly [number, number])[]>> =
  Object.fromEntries(
    Object.entries((rawData as RawAirportsDataset).airports).map(([iso, list]) => [
      iso,
      list.map(([lat = 0, lng = 0]) => [lat, lng] as const),
    ]),
  );

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

export function airportCountryId(iso: string): string {
  return `${ISO_ID_PREFIX}${iso}`;
}

export function airportCountryNameRu(iso: string): string {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

/**
 * Countries with airports, minus those already played. The weight grows slower than the airport
 * count (count^0.65, the same curve the polygon regions use for area), so the 505 airports of the
 * USA do not take every sixth round.
 */
export function getAirportCountryGroups(
  excludeIsoCodes: ReadonlySet<string> = new Set(),
): AirportCountryGroup[] {
  const all: AirportCountryGroup[] = Object.entries(AIRPORTS_BY_ISO)
    .filter(([, airports]) => airports.length > 0)
    .map(([iso, airports]) => ({ iso, airports, weight: Math.pow(airports.length, 0.65) }));
  const filtered = all.filter((group) => !excludeIsoCodes.has(group.iso));
  return filtered.length > 0 ? filtered : all;
}

/**
 * Picks a country, an airport in it and a point in the airport's zone. The distance from the
 * airport is uniform, so half of the probes land within half the zone radius: close to the
 * terminal rather than at the edge.
 */
export function sampleAirportProbe(
  groups: readonly AirportCountryGroup[],
  rng: () => number,
): AirportProbe {
  const group = sampleWeightedItem(groups, rng);
  const index = Math.min(group.airports.length - 1, Math.floor(rng() * group.airports.length));
  const [lat, lng] = group.airports[index] ?? [0, 0];
  const distanceKm = rng() * AIRPORT_ZONE_KM;
  const bearing = rng() * 2 * Math.PI;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return {
    iso: group.iso,
    airport: { lat, lng },
    probe: {
      lat: lat + (distanceKm * Math.cos(bearing)) / KM_PER_DEGREE,
      lng: lng + (distanceKm * Math.sin(bearing)) / (KM_PER_DEGREE * cosLat),
    },
  };
}

export function isInsideAirportZone(airport: LatLng, pos: LatLng): boolean {
  return haversineDistanceKm(airport, pos) <= AIRPORT_ZONE_KM;
}
