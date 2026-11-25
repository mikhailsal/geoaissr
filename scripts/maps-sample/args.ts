import { MAP_IDS, isMapId, type MapId } from '../../shared/maps.ts';
import { AREA_REGION_IDS, isRegionIdShape, type RegionId } from '../../shared/region-ids.ts';
import { isKnownRegion } from '../../shared/regions.ts';

export interface SampleArgs {
  map: MapId;
  region: RegionId;
  /** Rounds to look for. */
  rounds: number;
  /** Rounds per simulated match: a country is not repeated inside one. */
  matchRounds: number;
  seed: number | null;
  links: boolean;
  json: boolean;
  help: boolean;
}

export class SampleArgsError extends Error {}

export const SAMPLE_HELP = `maps:sample: look for round places the way a match does and report what comes out.

Usage: bun run maps:sample [--map <map>] [--region <region>] [--rounds <n>] [options]

  --map <map>        ${MAP_IDS.join(', ')} (default standard)
  --region <region>  ${AREA_REGION_IDS.join(', ')} or one country as country:FRA (default world)
  --rounds <n>       rounds to look for, 1..500 (default 20)
  --match <n>        rounds per simulated match, 1..20 (default 5); a country is not repeated inside one
  --seed <n>         fixed seed, for a run that picks the same probes again
  --links            print a Google Maps link for every round
  --json             print the summary as JSON
  --help             show this text

Needs GOOGLE_MAPS_SERVER_KEY in .env. It sends Street View metadata lookups only, which Google
does not bill; no image is requested and nothing is written to disk.

Exit status: 0 rounds were found; 3 no round was found; 4 a key, quota or network error cut the
run short (the summary of what it found is still printed).`;

function parseIntFlag(flag: string, raw: string | undefined, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n) || n < min || n > max) {
    throw new SampleArgsError(`${flag} needs a whole number from ${min} to ${max}`);
  }
  return n;
}

function parseMapFlag(raw: string | undefined): MapId {
  if (raw !== undefined && isMapId(raw)) return raw;
  throw new SampleArgsError(`--map needs one of: ${MAP_IDS.join(', ')}`);
}

function parseRegionFlag(raw: string | undefined): RegionId {
  if (raw !== undefined && isRegionIdShape(raw) && isKnownRegion(raw)) return raw;
  throw new SampleArgsError(
    `--region needs one of: ${AREA_REGION_IDS.join(', ')}, or a country as country:FRA`,
  );
}

export function parseSampleArgs(argv: readonly string[]): SampleArgs {
  const args: SampleArgs = {
    map: 'standard',
    region: 'world',
    rounds: 20,
    matchRounds: 5,
    seed: null,
    links: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--links') args.links = true;
    else if (flag === '--json') args.json = true;
    else {
      const value = argv[i + 1];
      i += 1;
      if (flag === '--map') args.map = parseMapFlag(value);
      else if (flag === '--region') args.region = parseRegionFlag(value);
      else if (flag === '--rounds') args.rounds = parseIntFlag(flag, value, 1, 500);
      else if (flag === '--match') args.matchRounds = parseIntFlag(flag, value, 1, 20);
      else if (flag === '--seed') args.seed = parseIntFlag(flag, value, 0, 2 ** 31 - 1);
      else throw new SampleArgsError(`Unknown flag "${flag}". Run with --help for the list.`);
    }
  }
  return args;
}
