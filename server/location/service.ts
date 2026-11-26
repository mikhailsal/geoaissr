import { MAP_LABELS_RU, type MapId } from '../../shared/maps.ts';
import type { RegionId } from '../../shared/region-ids.ts';
import { getRegionLabelRu } from '../../shared/regions.ts';
import type { RoundTarget } from '../engine/types.ts';
import { GeoError } from '../errors.ts';
import { getCoveredCountries } from '../maps/coverage.ts';
import { NORTH_MIN_LAT, getNorthCountries } from '../maps/north.ts';
import { getRetroCountries, isRetroYear } from '../maps/retro.ts';
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
  type RecentPlaces,
  type Roll,
  type RollContext,
  type RollHit,
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
/**
 * Share of its lookups a round spends on countries the match has not played and places not played
 * lately. A country or a place nobody has played may have no panorama at all, so after that share
 * the round takes any place of the map and region: it repeats one rather than fail.
 */
export const FRESH_ONLY_SHARE = 1 / 3;

/** A memory with nothing in it: every place counts as not played. */
const NOTHING_PLAYED: RecentPlaces = { has: () => false, add: () => undefined };

export class EmptyMapRegionError extends Error {
  constructor(map: MapId, region: RegionId) {
    super(`На карте «${MAP_LABELS_RU[map]}» нет мест в регионе «${getRegionLabelRu(region)}»`);
    this.name = 'EmptyMapRegionError';
  }
}

/**
 * The way a round looks for its place. `inTown` is the round's own choice between a settlement
 * and open land: it is made once, and both phases of the search keep it.
 */
function chooseRoll(ctx: RollContext, inTown: boolean): Roll {
  const { map, region, exclude } = ctx;
  if (isSourceMapId(map)) {
    const groups = getSourceGroups(map, region);
    if (groups.length === 0) throw new EmptyMapRegionError(map, region);
    return sourceRoll(ctx, groups);
  }
  if (map === 'north') {
    const countries = getNorthCountries(region, exclude);
    if (countries.length === 0) throw new EmptyMapRegionError(map, region);
    return inTown
      ? townRoll(ctx, countries, { landRadiusM: NORTH_LAND_RADIUS_M, minLat: NORTH_MIN_LAT })
      : polygonRoll(ctx, countries, NORTH_LAND_RADIUS_M);
  }
  if (map === 'retro') {
    const countries = getRetroCountries(region, exclude);
    if (countries.length === 0) throw new EmptyMapRegionError(map, region);
    const open = polygonRoll(ctx, countries, OPEN_LAND_RADIUS_M);
    const town = townRoll(ctx, countries, { landRadiusM: OPEN_LAND_RADIUS_M });
    // An old panorama may survive only in the towns of a country, or only outside them, so every
    // lookup of a retro round picks its kind anew, the way the scan measured the country.
    return () => (ctx.rng() < TOWN_ROUND_SHARE ? town() : open());
  }
  // The standard and wild maps keep to the countries where the coverage scan found panoramas of
  // the kind the round looks for: a country without them would spend the whole lookup budget.
  const land = getCoveredCountries(region, 'open', exclude);
  const open = land.length > 0 ? polygonRoll(ctx, land, OPEN_LAND_RADIUS_M) : null;
  if (map === 'wild') {
    if (!open) throw new EmptyMapRegionError(map, region);
    return open;
  }
  const towns = getCoveredCountries(region, 'town', exclude);
  const town = towns.length > 0 ? townRoll(ctx, towns, { landRadiusM: OPEN_LAND_RADIUS_M }) : null;
  // A country covered only in its towns (or only outside them) plays the kind it has.
  const roll = inTown ? (town ?? open) : (open ?? town);
  if (!roll) throw new EmptyMapRegionError(map, region);
  return roll;
}

function panoramaRule(map: MapId): RollContext['accepts'] {
  if (map === 'north') return (fix) => fix.lat >= NORTH_MIN_LAT;
  if (map === 'retro') return (fix) => isRetroYear(fix.year);
  return undefined;
}

/** A failure of the key or the quota: it stays, so the host has to see it. */
function isLastingFailure(reason: unknown): boolean {
  return reason instanceof GeoError && reason.code !== 'GEO_GOOGLE_UNREACHABLE';
}

/**
 * The earliest hit of a batch, so a seeded search gives the same round again. A refused key or a
 * spent quota ahead of that hit ends the search, as it would in a search that sends one lookup
 * at a time. A lookup lost in transit ends it only when the batch found no place: the lookups go
 * out together, and one of them may fail while another has already found the round.
 */
function firstHit(results: readonly PromiseSettledResult<RollHit | null>[]): RollHit | null {
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) return result.value;
    if (result.status === 'rejected' && isLastingFailure(result.reason)) throw result.reason;
  }
  for (const result of results) {
    if (result.status === 'rejected') {
      throw result.reason instanceof Error ? result.reason : new Error(String(result.reason));
    }
  }
  return null;
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
    const ctx: RollContext = {
      map,
      region,
      rng,
      find: metadata.find,
      exclude: new Set(input.excludeCountryIds),
      recent,
      accepts: panoramaRule(map),
    };
    const budget = ATTEMPT_BUDGET[map] ?? DEFAULT_ATTEMPT_BUDGET;
    const freshOnly = Math.ceil(budget * FRESH_ONLY_SHARE);
    const atOnce = LOOKUPS_AT_ONCE[map] ?? 1;
    const inTown = !isSourceMapId(map) && rng() < TOWN_ROUND_SHARE;
    let roll = chooseRoll(ctx, inTown);
    let anyPlace = false;
    for (let spent = 0; spent < budget; spent += atOnce) {
      if (!anyPlace && spent >= freshOnly) {
        roll = chooseRoll({ ...ctx, exclude: new Set(), recent: NOTHING_PLAYED }, inTown);
        anyPlace = true;
      }
      const size = Math.min(atOnce, budget - spent);
      const hit = firstHit(await Promise.allSettled(Array.from({ length: size }, () => roll())));
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
