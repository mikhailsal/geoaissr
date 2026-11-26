import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { MetadataClient, PanoFix } from '../../server/location/metadata.ts';
import {
  createRecentPlaces,
  polygonRoll,
  townRoll,
  type RollContext,
} from '../../server/location/rolls.ts';
import { OPEN_LAND_RADIUS_M } from '../../server/location/service.ts';
import type { MapId } from '../../shared/maps.ts';
import { countryRegionId } from '../../shared/region-ids.ts';
import { REGION_COUNTRIES, getWeightedCountriesForRegion } from '../../shared/regions.ts';

const LOOKUPS_AT_ONCE = 12;

export interface KindHits {
  /** Lookups of this kind the measurement sent into the country. */
  lookups: number;
  /** How many of them found a panorama a round would have taken. */
  hits: number;
}

export interface CountryHits extends KindHits {
  /** The lookups aimed at the country's settlements. */
  town: KindHits;
  /** The lookups at random points of its land. */
  open: KindHits;
}

/**
 * Sends lookups into one country the way a round does: half of them aimed at its settlements,
 * half at random points of its land. Counts those a round would have taken: a panorama across
 * the border or outside the settlement does not count, nor does one `accepts` turns down.
 */
export async function measureCountryHits(opts: {
  countryId: string;
  lookups: number;
  map: MapId;
  find: MetadataClient['find'];
  rng: () => number;
  accepts?: (fix: PanoFix) => boolean;
}): Promise<CountryHits> {
  const region = countryRegionId(opts.countryId);
  const ctx: RollContext = {
    map: opts.map,
    region,
    rng: opts.rng,
    find: opts.find,
    exclude: new Set(),
    recent: createRecentPlaces(),
    ...(opts.accepts ? { accepts: opts.accepts } : {}),
  };
  const countries = getWeightedCountriesForRegion(region);
  const rolls = {
    town: townRoll(ctx, countries, { landRadiusM: OPEN_LAND_RADIUS_M }),
    open: polygonRoll(ctx, countries, OPEN_LAND_RADIUS_M),
  };
  const stat = { town: { lookups: 0, hits: 0 }, open: { lookups: 0, hits: 0 } };
  const attempt = async (kind: 'town' | 'open'): Promise<void> => {
    stat[kind].lookups += 1;
    if (await rolls[kind]()) stat[kind].hits += 1;
  };
  for (let sent = 0; sent < opts.lookups; sent += LOOKUPS_AT_ONCE) {
    const size = Math.min(LOOKUPS_AT_ONCE, opts.lookups - sent);
    await Promise.all(
      Array.from({ length: size }, (_, i) => attempt((sent + i) % 2 === 0 ? 'town' : 'open')),
    );
  }
  return {
    ...stat,
    lookups: stat.town.lookups + stat.open.lookups,
    hits: stat.town.hits + stat.open.hits,
  };
}

/** A file path with the links of its folder followed, so a link to `server/maps` hides nothing. */
export function canonicalPath(file: string): string {
  const resolved = path.resolve(file);
  try {
    return path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
  } catch {
    // The folder does not exist yet, so it cannot be the folder of the tracked dataset.
    return resolved;
  }
}

/**
 * The countries one scan measures: all of them, or the ids `--only` lists. A part of the world
 * never replaces the tracked dataset, so `--only` needs an `--out` path of its own. An `--only`
 * that names no country is refused: an empty shell variable must not start a scan of the world.
 */
export function pickCountryIds(
  only: string | undefined,
  out: string | undefined,
  tracked: string,
): string[] {
  const all = REGION_COUNTRIES.map((country) => country.id);
  if (only === undefined) return all;
  const asked = only.split(',').filter(Boolean);
  if (asked.length === 0) throw new Error('--only: no country given (ids look like EST)');
  const unknown = asked.filter((id) => !all.includes(id));
  if (unknown.length > 0) {
    throw new Error(`--only: no such country: ${unknown.join(', ')} (ids look like EST)`);
  }
  if (out === undefined || canonicalPath(out) === canonicalPath(tracked)) {
    throw new Error(
      `--only needs --out <its own path>: only a full scan rewrites ${path.basename(tracked)}`,
    );
  }
  return all.filter((id) => asked.includes(id));
}
