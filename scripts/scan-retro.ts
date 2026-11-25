import path from 'node:path';
import { createMetadataClient, type MetadataClient } from '../server/location/metadata.ts';
import {
  createRecentPlaces,
  polygonRoll,
  townRoll,
  type RollContext,
} from '../server/location/rolls.ts';
import { OPEN_LAND_RADIUS_M } from '../server/location/service.ts';
import {
  RETRO_BEFORE_YEAR,
  type RetroCountryStat,
  type RetroDataset,
} from '../server/maps/retro.ts';
import { countryRegionId } from '../shared/region-ids.ts';
import { REGION_COUNTRIES, getWeightedCountriesForRegion } from '../shared/regions.ts';
import { parseBuilderArgs, writeDatasetFile } from './lib/dataset-io.ts';

/** Lookups every country gets in the first pass. */
export const FIRST_PASS_LOOKUPS = 120;
/** Further lookups for a country where the first pass found an old panorama. */
export const SECOND_PASS_LOOKUPS = 360;
/** A country stays on the map when at least this many of its lookups found an old panorama. */
export const MIN_OLD_FOUND = 5;
const LOOKUPS_AT_ONCE = 12;

export type RetroStats = Record<string, RetroCountryStat>;

/**
 * Sends lookups into one country the way a round of the retro map does: half of them aimed at
 * its settlements, half at random points of its land. Counts those that found an old panorama.
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
    find: async (pos, radiusM) => {
      stat.lookups += 1;
      const fix = await find(pos, radiusM);
      if (fix?.year !== null && fix?.year !== undefined && fix.year < RETRO_BEFORE_YEAR) {
        stat.old += 1;
      }
      return fix;
    },
    exclude: new Set(),
    recent: createRecentPlaces(),
  };
  const countries = getWeightedCountriesForRegion(region);
  const open = polygonRoll(ctx, countries, OPEN_LAND_RADIUS_M);
  const town = townRoll(ctx, countries, { fallback: open });
  for (let sent = 0; sent < lookups; sent += LOOKUPS_AT_ONCE) {
    const size = Math.min(LOOKUPS_AT_ONCE, lookups - sent);
    await Promise.all(
      Array.from({ length: size }, (_, i) => ((sent + i) % 2 === 0 ? town() : open())),
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
 * Measures where the search still finds panoramas shot before the retro limit and rewrites
 * `server/maps/retro.data.json`. Needs `GOOGLE_MAPS_SERVER_KEY`; metadata lookups are free of
 * charge, a full run sends about 35 thousand of them and takes about half an hour.
 * `--only EST,IRL` measures some countries; `--out <path>` writes elsewhere.
 */
if (import.meta.main) {
  const args = parseBuilderArgs(process.argv.slice(2), ['only', 'out']);
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY?.trim() ?? '';
  if (!serverKey) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set (see .env.example)');
  const only = (args.only ?? '').split(',').filter(Boolean);
  const countryIds = REGION_COUNTRIES.map((country) => country.id).filter(
    (id) => only.length === 0 || only.includes(id),
  );
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
  const outPath = args.out ?? path.resolve(import.meta.dir, '../server/maps/retro.data.json');
  writeDatasetFile(outPath, dataset);
  console.log('Generated', outPath, 'countries:', Object.keys(dataset.countries).length);
}
