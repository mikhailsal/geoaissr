import type { MapId } from '../../shared/maps.ts';
import type { RegionId } from '../../shared/region-ids.ts';
import { pointInRing } from '../../shared/regions.ts';
import { haversineDistanceKm, type LatLng } from '../../shared/score.ts';
import { AIRPORTS_BY_ISO, AIRPORT_SNAP_RADIUS_M, AIRPORT_ZONE_KM } from './airports.ts';
import { URBAN_CENTRES, type UrbanCentre } from './cities.ts';
import { countryForIso, isPlaceInRegion } from './countries.ts';
import { isCountryBare } from './coverage.ts';
import { distanceToSegmentKm, randomPointAround } from './geo.ts';
import { ALL_PLACES, settlementRadiusKm, type Place } from './places.ts';

/** Maps whose rounds start around a known point: an airport, a city, a capital. */
export const SOURCE_MAP_IDS = [
  'cities',
  'megacities',
  'capitals',
  'airports',
  'highlands',
] as const;
export type SourceMapId = (typeof SOURCE_MAP_IDS)[number];

export function isSourceMapId(map: MapId): map is SourceMapId {
  return (SOURCE_MAP_IDS as readonly string[]).includes(map);
}

/** One place a round can start around. */
export interface RoundSource {
  /** Stable identity, used to avoid the same place twice in a row. */
  placeKey: string;
  /** ISO 3166-1 alpha-2 code of the country the place belongs to. */
  iso: string;
  centre: LatLng;
  weight: number;
  /** Search radius around a probe, in metres. */
  snapRadiusM: number;
  /** A random point to look for a panorama at. */
  probe: (rng: () => number) => LatLng;
  /** Whether a panorama found near a probe still belongs to the place. */
  accepts: (pano: LatLng) => boolean;
}

/** The places of one country. The weight decides how often the country comes up. */
export interface SourceGroup {
  iso: string;
  weight: number;
  sources: RoundSource[];
}

export const MEGACITY_MIN_POPULATION = 5_000_000;
export const HIGHLAND_MIN_POPULATION = 100_000;
export const HIGHLAND_MIN_ELEVATION_M = 2000;
/** Search radius around a probe inside a settlement, in metres. */
export const SETTLEMENT_SNAP_RADIUS_M = 750;
/** A panorama this far outside a settlement's built-up radius still counts as the settlement. */
const SETTLEMENT_SLACK_KM = 1;
/** A city round stays within this many built-up radii of the core city. */
const CITY_CORE_REACH = 1.5;
/** A panorama this far outside the dense outline still counts: the outline is a 1 km grid. */
const CITY_OUTLINE_SLACK_KM = 0.5;

function airportSource(iso: string, lat: number, lng: number): RoundSource {
  const centre = { lat, lng };
  return {
    placeKey: `airport:${lat},${lng}`,
    iso,
    centre,
    weight: 1,
    snapRadiusM: AIRPORT_SNAP_RADIUS_M,
    // An even distance puts half of the probes within half the zone: near the terminal.
    probe: (rng) => randomPointAround(centre, AIRPORT_ZONE_KM, rng, true),
    accepts: (pano) => haversineDistanceKm(centre, pano) <= AIRPORT_ZONE_KM,
  };
}

/** A round around the centre of a settlement, inside its built-up radius. */
export function settlementSource(place: Place, prefix: string): RoundSource {
  const radiusKm = settlementRadiusKm(place.population);
  return {
    placeKey: `${prefix}:${place.lat},${place.lng}`,
    iso: place.iso,
    centre: place,
    weight: Math.sqrt(Math.max(1, place.population)),
    snapRadiusM: SETTLEMENT_SNAP_RADIUS_M,
    probe: (rng) => randomPointAround(place, radiusKm, rng),
    accepts: (pano) => haversineDistanceKm(place, pano) <= radiusKm + SETTLEMENT_SLACK_KM,
  };
}

function isInsideOutline(centre: UrbanCentre, pos: LatLng): boolean {
  return centre.rings.some((ring) => pointInRing(pos.lng, pos.lat, ring));
}

/** Inside the outline, or within the slack of one of its edges (an edge can run for kilometres). */
function isNearOutline(centre: UrbanCentre, pos: LatLng): boolean {
  if (isInsideOutline(centre, pos)) return true;
  return centre.rings.some((ring) =>
    ring.some(([lng, lat], i) => {
      const [nextLng, nextLat] = ring[(i + 1) % ring.length] ?? [lng, lat];
      const km = distanceToSegmentKm(pos, { lat, lng }, { lat: nextLat, lng: nextLng });
      return km <= CITY_OUTLINE_SLACK_KM;
    }),
  );
}

/** A round inside the dense outline of an urban centre, not too far from its core city. */
function citySource(centre: UrbanCentre): RoundSource {
  const reachKm = CITY_CORE_REACH * settlementRadiusKm(centre.population);
  const [minLng, minLat, maxLng, maxLat] = centre.bbox;
  return {
    placeKey: `city:${centre.core.lat},${centre.core.lng}`,
    iso: centre.iso,
    centre: centre.core,
    weight: Math.sqrt(centre.population),
    snapRadiusM: SETTLEMENT_SNAP_RADIUS_M,
    probe: (rng) => {
      for (let i = 0; i < 200; i += 1) {
        const pos = {
          lat: minLat + rng() * (maxLat - minLat),
          lng: minLng + rng() * (maxLng - minLng),
        };
        if (haversineDistanceKm(centre.core, pos) > reachKm) continue;
        if (isInsideOutline(centre, pos)) return pos;
      }
      return centre.core;
    },
    accepts: (pano) =>
      haversineDistanceKm(centre.core, pano) <= reachKm + CITY_OUTLINE_SLACK_KM &&
      isNearOutline(centre, pano),
  };
}

function rawSources(map: SourceMapId): RoundSource[] {
  if (map === 'airports') {
    return Object.entries(AIRPORTS_BY_ISO).flatMap(([iso, list]) =>
      list.map(([lat, lng]) => airportSource(iso, lat, lng)),
    );
  }
  if (map === 'cities') return URBAN_CENTRES.map(citySource);
  if (map === 'megacities') {
    return URBAN_CENTRES.filter((c) => c.population >= MEGACITY_MIN_POPULATION).map(citySource);
  }
  if (map === 'capitals') {
    return ALL_PLACES.filter((place) => place.capital).map((p) => settlementSource(p, 'capital'));
  }
  return ALL_PLACES.filter(
    (place) =>
      !place.district &&
      place.population >= HIGHLAND_MIN_POPULATION &&
      place.elevation >= HIGHLAND_MIN_ELEVATION_M,
  ).map((p) => settlementSource(p, 'highland'));
}

/**
 * The places of a map, minus those of a country where the coverage scan found next to nothing:
 * mainland China, Iran, North Korea. A round sent there would spend its whole budget.
 */
function buildSources(map: SourceMapId): RoundSource[] {
  return rawSources(map).filter((source) => !isCountryBare(countryForIso(source.iso).id));
}

const sourcesCache = new Map<SourceMapId, RoundSource[]>();

function allSources(map: SourceMapId): RoundSource[] {
  const cached = sourcesCache.get(map);
  if (cached) return cached;
  const built = buildSources(map);
  sourcesCache.set(map, built);
  return built;
}

/**
 * How often a country comes up. On the capitals map every country is equally likely. Elsewhere
 * the weight grows slower than the number of places (count^0.65, the curve the polygon regions
 * use for area), so the 505 airports of the USA do not take every sixth round.
 */
function groupWeight(map: SourceMapId, count: number): number {
  return map === 'capitals' ? 1 : Math.pow(count, 0.65);
}

const groupsCache = new Map<string, SourceGroup[]>();

/** The places of a map inside a region, grouped by country. Empty when the map has none there. */
export function getSourceGroups(map: SourceMapId, region: RegionId): SourceGroup[] {
  const cacheKey = `${map}|${region}`;
  const cached = groupsCache.get(cacheKey);
  if (cached) return cached;
  const byIso = new Map<string, RoundSource[]>();
  for (const source of allSources(map)) {
    if (!isPlaceInRegion(source.iso, source.centre, region)) continue;
    const list = byIso.get(source.iso);
    if (list) list.push(source);
    else byIso.set(source.iso, [source]);
  }
  const groups = [...byIso.entries()].map(([iso, sources]) => ({
    iso,
    sources,
    weight: groupWeight(map, sources.length),
  }));
  groupsCache.set(cacheKey, groups);
  return groups;
}
