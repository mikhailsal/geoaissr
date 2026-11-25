import { MAP_LABELS_RU, type MapId } from '../../shared/maps.ts';
import type { RegionId } from '../../shared/region-ids.ts';
import { getRegionLabelRu, getWeightedCountriesForRegion } from '../../shared/regions.ts';
import type { RoundTarget } from '../engine/types.ts';
import { NORTH_MIN_LAT, getNorthCountries } from '../maps/north.ts';
import { RETRO_BEFORE_YEAR, getRetroCountries } from '../maps/retro.ts';
import { getSourceGroups, isSourceMapId } from '../maps/sources.ts';
import {
  createMetadataClient,
  type FetchLike,
  type MetadataClient,
  type SvMetadataResponse,
} from './metadata.ts';
import {
  createRecentPlaces,
  polygonRoll,
  sourceRoll,
  townRoll,
  type Roll,
  type RollContext,
} from './rolls.ts';

export interface RoundLocationRequest {
  map: MapId;
  region: RegionId;
  excludeCountryIds: readonly string[];
}

export interface LocationService {
  prepareRoundLocation: (opts: RoundLocationRequest) => Promise<RoundTarget>;
  queryMetadata: (lat: number, lng: number, radius?: number) => Promise<SvMetadataResponse | null>;
}

/** Share of rounds of the standard, north and retro maps that start in a settlement. */
export const TOWN_ROUND_SHARE = 0.5;
/** Search radius around a random point of a country's land, in metres. */
export const OPEN_LAND_RADIUS_M = 5000;
/** North of 60° the roads are far apart, so a random point looks further for one. */
const NORTH_LAND_RADIUS_M = 50_000;
/** Lookups a round may spend before the search is given up, by map. */
const ATTEMPT_BUDGET: Readonly<Partial<Record<MapId, number>>> = { retro: 600, north: 150 };
const DEFAULT_ATTEMPT_BUDGET = 90;
/**
 * Lookups a round sends at the same time. An old panorama turns up once in tens of lookups, so
 * the retro map asks for several at once; the other maps find a place in two or three.
 */
const LOOKUPS_AT_ONCE: Readonly<Partial<Record<MapId, number>>> = { retro: 12 };

export class EmptyMapRegionError extends Error {
  constructor(map: MapId, region: RegionId) {
    super(`На карте «${MAP_LABELS_RU[map]}» нет мест в регионе «${getRegionLabelRu(region)}»`);
    this.name = 'EmptyMapRegionError';
  }
}

/** The way one round looks for its place; decided once, then repeated until a place is found. */
function chooseRoll(ctx: RollContext): Roll {
  const { map, region, exclude } = ctx;
  if (isSourceMapId(map)) {
    const groups = getSourceGroups(map, region);
    if (groups.length === 0) throw new EmptyMapRegionError(map, region);
    return sourceRoll(ctx, groups);
  }
  const inTown = ctx.rng() < TOWN_ROUND_SHARE;
  if (map === 'north') {
    const countries = getNorthCountries(region, exclude);
    if (countries.length === 0) throw new EmptyMapRegionError(map, region);
    const open = polygonRoll(ctx, countries, NORTH_LAND_RADIUS_M);
    return inTown ? townRoll(ctx, countries, { fallback: open, minLat: NORTH_MIN_LAT }) : open;
  }
  const countries =
    map === 'retro'
      ? getRetroCountries(region, exclude)
      : getWeightedCountriesForRegion(region, exclude);
  if (countries.length === 0) throw new EmptyMapRegionError(map, region);
  const open = polygonRoll(ctx, countries, OPEN_LAND_RADIUS_M);
  if (map === 'wild' || !inTown) return open;
  return townRoll(ctx, countries, { fallback: open });
}

function panoramaRule(map: MapId): RollContext['accepts'] {
  if (map === 'north') return (fix) => fix.lat >= NORTH_MIN_LAT;
  if (map === 'retro') return (fix) => fix.year !== null && fix.year < RETRO_BEFORE_YEAR;
  return undefined;
}

export function createLocationService(opts: {
  serverKey: string;
  fetchImpl?: FetchLike;
  rng?: () => number;
  /** The sampling tool passes its own client to count lookups. */
  metadata?: MetadataClient;
}): LocationService {
  const metadata = opts.metadata ?? createMetadataClient(opts);
  const rng = opts.rng ?? Math.random;
  const recent = createRecentPlaces();

  async function prepareRoundLocation(input: RoundLocationRequest): Promise<RoundTarget> {
    const { map, region } = input;
    const roll = chooseRoll({
      map,
      region,
      rng,
      find: metadata.find,
      exclude: new Set(input.excludeCountryIds),
      recent,
      accepts: panoramaRule(map),
    });
    const budget = ATTEMPT_BUDGET[map] ?? DEFAULT_ATTEMPT_BUDGET;
    const atOnce = LOOKUPS_AT_ONCE[map] ?? 1;
    for (let spent = 0; spent < budget; spent += atOnce) {
      const size = Math.min(atOnce, budget - spent);
      const hits = await Promise.all(Array.from({ length: size }, () => roll()));
      // The earliest attempt of the batch wins, so a seeded search gives the same round again.
      const hit = hits.find((entry) => entry !== null);
      if (!hit) continue;
      if (hit.placeKey !== undefined) recent.add(hit.placeKey);
      return hit.target;
    }
    throw new Error(
      `Не удалось найти уличную панораму Google: карта «${MAP_LABELS_RU[map]}», регион «${getRegionLabelRu(region)}», ${budget} попыток`,
    );
  }

  return { prepareRoundLocation, queryMetadata: metadata.query };
}
