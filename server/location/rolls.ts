import type { MapId } from '../../shared/maps.ts';
import type { RegionId } from '../../shared/region-ids.ts';
import {
  findCountryAtPoint,
  samplePointInPolygon,
  sampleWeightedItem,
  type RegionPolygon,
  type WeightedCountry,
} from '../../shared/regions.ts';
import type { RoundTarget } from '../engine/types.ts';
import { countryForIso, isPlaceInRegion, isoCodesOfCountryIds } from '../maps/countries.ts';
import type { MapCountry } from '../maps/countries.ts';
import { labelCountryIso } from '../maps/country-label.ts';
import { placesOfIso } from '../maps/places.ts';
import { settlementSource, type RoundSource, type SourceGroup } from '../maps/sources.ts';
import type { MetadataClient, PanoFix } from './metadata.ts';

/** Remembers the places of the last rounds, so the next round starts somewhere else. */
export interface RecentPlaces {
  has: (key: string) => boolean;
  add: (key: string) => void;
}

export function createRecentPlaces(limit = 40): RecentPlaces {
  const keys: string[] = [];
  return {
    has: (key) => keys.includes(key),
    add: (key) => {
      keys.push(key);
      if (keys.length > limit) keys.shift();
    },
  };
}

export interface RollContext {
  map: MapId;
  region: RegionId;
  rng: () => number;
  find: MetadataClient['find'];
  /** Ids of the countries already played in the match. */
  exclude: ReadonlySet<string>;
  recent: RecentPlaces;
  /** An extra condition of the map on the panorama itself (its age, its latitude). */
  accepts?: (fix: PanoFix) => boolean;
}

export interface RollHit {
  target: RoundTarget;
  /** The place the attempt aimed at, to remember as played; absent for a random point. */
  placeKey?: string;
}

/** One attempt to find a place for a round; null when the attempt found nothing usable. */
export type Roll = () => Promise<RollHit | null>;

function makeTarget(ctx: RollContext, fix: PanoFix, country: MapCountry): RoundTarget {
  return {
    panoId: fix.panoId,
    lat: fix.lat,
    lng: fix.lng,
    countryId: country.id,
    countryNameRu: country.nameRu,
    map: ctx.map,
    region: ctx.region,
    fakeSceneIndex: 0,
  };
}

function pickWeightedPolygon(entry: WeightedCountry, rng: () => number): RegionPolygon {
  if (entry.polygons.length === 1 && entry.polygons[0]) {
    return entry.polygons[0];
  }
  return sampleWeightedItem(
    entry.polygons.map((p) => ({ poly: p, weight: Math.max(0.01, p.area) })),
    rng,
  ).poly;
}

/** A random point of a country's land: mostly far from any town. */
export function polygonRoll(
  ctx: RollContext,
  countries: readonly WeightedCountry[],
  radiusM: number,
): Roll {
  const allowedIds = new Set(countries.map((entry) => entry.country.id));
  return async () => {
    const picked = sampleWeightedItem(countries, ctx.rng);
    const pos = samplePointInPolygon(pickWeightedPolygon(picked, ctx.rng), ctx.rng);
    const fix = await ctx.find(pos, radiusM);
    if (!fix || ctx.accepts?.(fix) === false) return null;
    const resolved = findCountryAtPoint(fix);
    // The snapped pano can sit across a border: outside the region or in a country already played.
    if (resolved && !allowedIds.has(resolved.id)) return null;
    return { target: makeTarget(ctx, fix, resolved ?? picked.country) };
  };
}

async function rollSource(
  ctx: RollContext,
  source: RoundSource,
  allows: (country: MapCountry) => boolean,
): Promise<RollHit | null> {
  const fix = await ctx.find(source.probe(ctx.rng), source.snapRadiusM);
  if (!fix || !source.accepts(fix) || ctx.accepts?.(fix) === false) return null;
  const iso = labelCountryIso(source, fix);
  if (!isPlaceInRegion(iso, fix, ctx.region)) return null;
  const country = countryForIso(iso);
  if (!allows(country)) return null;
  return { target: makeTarget(ctx, fix, country), placeKey: source.placeKey };
}

function pickSource(sources: readonly RoundSource[], ctx: RollContext): RoundSource {
  const fresh = sources.filter((source) => !ctx.recent.has(source.placeKey));
  return sampleWeightedItem(fresh.length > 0 ? fresh : sources, ctx.rng);
}

/** A place of a point map: an airport, a city, a capital. */
export function sourceRoll(ctx: RollContext, groups: readonly SourceGroup[]): Roll {
  const playedIso = isoCodesOfCountryIds(ctx.exclude);
  const open = groups.filter((group) => !playedIso.has(group.iso));
  // Once every country of the map was played, all of them are open again.
  const exclusionsHold = open.length > 0;
  const usable = exclusionsHold ? open : groups;
  return async () => {
    // A country whose every place was played lately waits while others have fresh ones.
    const fresh = usable.filter((entry) =>
      entry.sources.some((src) => !ctx.recent.has(src.placeKey)),
    );
    const group = sampleWeightedItem(fresh.length > 0 ? fresh : usable, ctx.rng);
    return rollSource(
      ctx,
      pickSource(group.sources, ctx),
      (country) => !exclusionsHold || !ctx.exclude.has(country.id),
    );
  };
}

const townsCache = new Map<string, RoundSource[]>();

/** Settlements of a country inside the region, optionally only north of a parallel. */
function townSources(iso: string, region: RegionId, minLat: number | null): RoundSource[] {
  const cacheKey = `${iso}|${region}|${minLat ?? ''}`;
  const cached = townsCache.get(cacheKey);
  if (cached) return cached;
  const towns = placesOfIso(iso)
    .filter((place) => minLat === null || place.lat >= minLat)
    .filter((place) => isPlaceInRegion(iso, place, region))
    .map((place) => settlementSource(place, 'town'));
  townsCache.set(cacheKey, towns);
  return towns;
}

/**
 * A settlement of a country picked the same way the polygon roll picks one, so the mix of
 * countries does not change. A country without known settlements falls back to its land.
 */
export function townRoll(
  ctx: RollContext,
  countries: readonly WeightedCountry[],
  opts: { fallback: Roll; minLat?: number },
): Roll {
  const allowedIds = new Set(countries.map((entry) => entry.country.id));
  return async () => {
    const picked = sampleWeightedItem(countries, ctx.rng);
    const towns = townSources(picked.country.iso, ctx.region, opts.minLat ?? null);
    if (towns.length === 0) return opts.fallback();
    return rollSource(ctx, pickSource(towns, ctx), (country) => allowedIds.has(country.id));
  };
}
