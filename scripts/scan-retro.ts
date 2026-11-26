import path from 'node:path';
import { createMetadataClient, type MetadataClient } from '../server/location/metadata.ts';
import {
  RETRO_BEFORE_YEAR,
  isRetroYear,
  type RetroCountryStat,
  type RetroDataset,
} from '../server/maps/retro.ts';
import { measureCountryHits, pickCountryIds } from './lib/country-scan.ts';
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

/** The dataset the retro map plays from; only a scan of every country may rewrite it. */
const TRACKED_DATASET = path.resolve(import.meta.dir, '../server/maps/retro.data.json');

export type RetroStats = Record<string, RetroCountryStat>;

/**
 * Sends lookups into one country the way a round of the retro map does and counts those that
 * found a panorama older than the limit.
 */
export async function measureCountry(
  countryId: string,
  lookups: number,
  find: MetadataClient['find'],
  rng: () => number,
): Promise<RetroCountryStat> {
  const stat = await measureCountryHits({
    countryId,
    lookups,
    map: 'retro',
    find,
    rng,
    accepts: (fix) => isRetroYear(fix.year),
  });
  return { lookups: stat.lookups, old: stat.hits };
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

/** The countries one run measures; see `pickCountryIds`. */
export function pickScanCountries(only: string | undefined, out: string | undefined): string[] {
  return pickCountryIds(only, out, TRACKED_DATASET);
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
