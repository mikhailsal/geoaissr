import { realpathSync } from 'node:fs';
import path from 'node:path';
import { createMetadataClient, type MetadataClient } from '../server/location/metadata.ts';
import {
  createRecentPlaces,
  polygonRoll,
  townRoll,
  type Roll,
  type RollContext,
} from '../server/location/rolls.ts';
import { OPEN_LAND_RADIUS_M } from '../server/location/service.ts';
import {
  RETRO_BEFORE_YEAR,
  isRetroYear,
  type RetroCountryStat,
  type RetroDataset,
} from '../server/maps/retro.ts';
import { countryRegionId } from '../shared/region-ids.ts';
import { REGION_COUNTRIES, getWeightedCountriesForRegion } from '../shared/regions.ts';
import { parseBuilderArgs, writeDatasetFile } from './lib/dataset-io.ts';

/**
 * Lookups every country gets in the first pass. A country right at the bar below finds an old
 * panorama once in 96 lookups: 240 of them miss it one time in twelve, 120 one time in three.
 */
export const FIRST_PASS_LOOKUPS = 240;
/** Further lookups for a country where the first pass found an old panorama. */
export const SECOND_PASS_LOOKUPS = 240;
/** A country stays on the map when at least this many of its lookups found an old panorama. */
export const MIN_OLD_FOUND = 5;
const LOOKUPS_AT_ONCE = 12;

/** The dataset the retro map plays from; only a scan of every country may rewrite it. */
const TRACKED_DATASET = path.resolve(import.meta.dir, '../server/maps/retro.data.json');

/** A file path with the links of its folder followed, so a link to `server/maps` hides nothing. */
function canonicalPath(file: string): string {
  const resolved = path.resolve(file);
  try {
    return path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
  } catch {
    // The folder does not exist yet, so it cannot be the folder of the tracked dataset.
    return resolved;
  }
}

export type RetroStats = Record<string, RetroCountryStat>;

/**
 * Sends lookups into one country the way a round of the retro map does: half of them aimed at
 * its settlements, half at random points of its land. Counts those a round would have taken: an
 * old panorama across the border or outside the settlement does not count.
 */
export async function measureCountry(
  countryId: string,
  lookups: number,
  find: MetadataClient['find'],
  rng: () => number,
): Promise<RetroCountryStat> {
  const region = countryRegionId(countryId);
  const stat: RetroCountryStat = { lookups: 0, old: 0 };
  const ctx: RollContext = {
    map: 'retro',
    region,
    rng,
    find: (pos, radiusM) => {
      stat.lookups += 1;
      return find(pos, radiusM);
    },
    exclude: new Set(),
    recent: createRecentPlaces(),
    accepts: (fix) => isRetroYear(fix.year),
  };
  const countries = getWeightedCountriesForRegion(region);
  const open = polygonRoll(ctx, countries, OPEN_LAND_RADIUS_M);
  const town = townRoll(ctx, countries, { fallback: open });
  const attempt = async (roll: Roll): Promise<void> => {
    if (await roll()) stat.old += 1;
  };
  for (let sent = 0; sent < lookups; sent += LOOKUPS_AT_ONCE) {
    const size = Math.min(LOOKUPS_AT_ONCE, lookups - sent);
    await Promise.all(
      Array.from({ length: size }, (_, i) => attempt((sent + i) % 2 === 0 ? town : open)),
    );
  }
  return stat;
}

/** Two passes: every country first, then a closer look where an old panorama turned up. */
export async function scanRetro(opts: {
  countryIds: readonly string[];
  find: MetadataClient['find'];
  rng: () => number;
  firstPass?: number;
  secondPass?: number;
  onCountry?: (countryId: string, stat: RetroCountryStat) => void;
}): Promise<RetroStats> {
  const stats: RetroStats = {};
  for (const countryId of opts.countryIds) {
    const first = await measureCountry(
      countryId,
      opts.firstPass ?? FIRST_PASS_LOOKUPS,
      opts.find,
      opts.rng,
    );
    const second =
      first.old > 0
        ? await measureCountry(
            countryId,
            opts.secondPass ?? SECOND_PASS_LOOKUPS,
            opts.find,
            opts.rng,
          )
        : { lookups: 0, old: 0 };
    const stat = { lookups: first.lookups + second.lookups, old: first.old + second.old };
    stats[countryId] = stat;
    opts.onCountry?.(countryId, stat);
  }
  return stats;
}

/** The countries the retro map keeps, in the order of the regions dataset. */
export function selectRetroCountries(stats: RetroStats, minOld = MIN_OLD_FOUND): RetroStats {
  return Object.fromEntries(Object.entries(stats).filter(([, stat]) => stat.old >= minOld));
}

/**
 * The countries one run measures: all of them, or the ids `--only` lists. A part of the world
 * never replaces the tracked dataset, so `--only` needs an `--out` path of its own. An `--only`
 * that names no country is refused: an empty shell variable must not start a scan of the world.
 */
export function pickScanCountries(only: string | undefined, out: string | undefined): string[] {
  const all = REGION_COUNTRIES.map((country) => country.id);
  if (only === undefined) return all;
  const asked = only.split(',').filter(Boolean);
  if (asked.length === 0) throw new Error('--only: no country given (ids look like EST)');
  const unknown = asked.filter((id) => !all.includes(id));
  if (unknown.length > 0) {
    throw new Error(`--only: no such country: ${unknown.join(', ')} (ids look like EST)`);
  }
  if (out === undefined || canonicalPath(out) === canonicalPath(TRACKED_DATASET)) {
    throw new Error('--only needs --out <its own path>: only a full scan rewrites retro.data.json');
  }
  return all.filter((id) => asked.includes(id));
}

/**
 * Measures where the search still finds panoramas shot before the retro limit and rewrites
 * `server/maps/retro.data.json`. Needs `GOOGLE_MAPS_SERVER_KEY`; metadata lookups are free of
 * charge, a full run sends about 50 thousand of them and takes about half an hour.
 * `--out <path>` writes elsewhere; `--only EST,IRL --out <path>` measures some countries.
 */
if (import.meta.main) {
  const args = parseBuilderArgs(process.argv.slice(2), ['only', 'out']);
  const countryIds = pickScanCountries(args.only, args.out);
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY?.trim() ?? '';
  if (!serverKey) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set (see .env.example)');
  const stats = await scanRetro({
    countryIds,
    find: createMetadataClient({ serverKey }).find,
    rng: Math.random,
    onCountry: (id, stat) => {
      console.log(id, `${stat.old} of ${stat.lookups} lookups found an old panorama`);
    },
  });
  const dataset: RetroDataset = {
    version: 1,
    measured: new Date().toISOString().slice(0, 7),
    beforeYear: RETRO_BEFORE_YEAR,
    countries: selectRetroCountries(stats),
  };
  const outPath = args.out ?? TRACKED_DATASET;
  writeDatasetFile(outPath, dataset);
  console.log('Generated', outPath, 'countries:', Object.keys(dataset.countries).length);
}
