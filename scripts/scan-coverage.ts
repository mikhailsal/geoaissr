import path from 'node:path';
import { createMetadataClient, type MetadataClient } from '../server/location/metadata.ts';
import type {
  CoverageCountryStat,
  CoverageDataset,
  CoverageKindStat,
} from '../server/maps/coverage.ts';
import { measureCountryHits, pickCountryIds } from './lib/country-scan.ts';
import { parseBuilderArgs, writeDatasetFile } from './lib/dataset-io.ts';

/**
 * Lookups every country gets in the first pass, half of them of each kind. A kind right at the
 * bar finds a panorama once in 40 lookups: 120 of them miss it one time in twenty.
 */
export const FIRST_PASS_LOOKUPS = 240;
/** Further lookups for a country where the first pass left a kind near the bar. */
export const SECOND_PASS_LOOKUPS = 240;
/** The first pass settles a kind that found nothing, or at least this many panoramas. */
export const CLEAR_FIRST_PASS_FOUND = 8;

/** The dataset the lobby and the round search read; only a scan of every country rewrites it. */
const TRACKED_DATASET = path.resolve(import.meta.dir, '../server/maps/coverage.data.json');

export type CoverageStats = Record<string, CoverageCountryStat>;

async function measure(
  countryId: string,
  lookups: number,
  find: MetadataClient['find'],
  rng: () => number,
): Promise<CoverageCountryStat> {
  if (lookups <= 0) return { town: { lookups: 0, found: 0 }, open: { lookups: 0, found: 0 } };
  const stat = await measureCountryHits({ countryId, lookups, map: 'standard', find, rng });
  return {
    town: { lookups: stat.town.lookups, found: stat.town.hits },
    open: { lookups: stat.open.lookups, found: stat.open.hits },
  };
}

function isUnclear(stat: CoverageKindStat): boolean {
  return stat.found > 0 && stat.found < CLEAR_FIRST_PASS_FOUND;
}

function sum(a: CoverageKindStat, b: CoverageKindStat): CoverageKindStat {
  return { lookups: a.lookups + b.lookups, found: a.found + b.found };
}

/** Two passes: every country first, then a closer look at the countries near the bar. */
export async function scanCoverage(opts: {
  countryIds: readonly string[];
  find: MetadataClient['find'];
  rng: () => number;
  firstPass?: number;
  secondPass?: number;
  onCountry?: (countryId: string, stat: CoverageCountryStat) => void;
}): Promise<CoverageStats> {
  const stats: CoverageStats = {};
  for (const countryId of opts.countryIds) {
    const first = await measure(
      countryId,
      opts.firstPass ?? FIRST_PASS_LOOKUPS,
      opts.find,
      opts.rng,
    );
    const again = isUnclear(first.town) || isUnclear(first.open);
    const second = await measure(
      countryId,
      again ? (opts.secondPass ?? SECOND_PASS_LOOKUPS) : 0,
      opts.find,
      opts.rng,
    );
    const stat = { town: sum(first.town, second.town), open: sum(first.open, second.open) };
    stats[countryId] = stat;
    opts.onCountry?.(countryId, stat);
  }
  return stats;
}

/** The countries one run measures; see `pickCountryIds`. */
export function pickScanCountries(only: string | undefined, out: string | undefined): string[] {
  return pickCountryIds(only, out, TRACKED_DATASET);
}

/**
 * Measures in which countries the round search finds official Street View panoramas and rewrites
 * `server/maps/coverage.data.json`. Needs `GOOGLE_MAPS_SERVER_KEY`; metadata lookups are free of
 * charge, a full run sends about 70 thousand of them and takes about half an hour.
 * `--out <path>` writes elsewhere; `--only EST,IRL --out <path>` measures some countries.
 * Run `bun run build:map-availability` after a full scan.
 */
if (import.meta.main) {
  const args = parseBuilderArgs(process.argv.slice(2), ['only', 'out']);
  const countryIds = pickScanCountries(args.only, args.out);
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY?.trim() ?? '';
  if (!serverKey) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set (see .env.example)');
  const stats = await scanCoverage({
    countryIds,
    find: createMetadataClient({ serverKey }).find,
    rng: Math.random,
    onCountry: (id, stat) => {
      console.log(
        id,
        `towns ${stat.town.found}/${stat.town.lookups}, open land ${stat.open.found}/${stat.open.lookups}`,
      );
    },
  });
  const dataset: CoverageDataset = {
    version: 1,
    measured: new Date().toISOString().slice(0, 7),
    countries: stats,
  };
  const outPath = args.out ?? TRACKED_DATASET;
  writeDatasetFile(outPath, dataset);
  console.log('Generated', outPath, 'countries:', Object.keys(stats).length);
}
