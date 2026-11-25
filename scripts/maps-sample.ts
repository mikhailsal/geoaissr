import { createMetadataClient } from '../server/location/metadata.ts';
import { createLocationService } from '../server/location.ts';
import { seededRng } from '../server/maps/rng.ts';
import {
  SAMPLE_HELP,
  SampleArgsError,
  parseSampleArgs,
  type SampleArgs,
} from './maps-sample/args.ts';
import {
  describeRound,
  sampleExitCode,
  summarize,
  type SampleSummary,
  type SampledRound,
  type SearchCost,
} from './maps-sample/stats.ts';

function formatRound(index: number, round: SampledRound, links: boolean): string {
  const town =
    round.nearestTownKm === null
      ? 'no town within 300 km'
      : `nearest town ${round.nearestTownKm} km (${round.nearestTownPopulation ?? 0} people)`;
  const link = links ? `  https://www.google.com/maps/@${round.lat},${round.lng},15z` : '';
  return `${String(index).padStart(3)}  ${round.countryNameRu}  ${round.inSettlement ? 'settlement' : 'open land'}  ${town}  lookups ${round.lookups}  ${round.seconds.toFixed(1)} s${link}`;
}

function formatSummary(summary: SampleSummary): string {
  const share =
    summary.inSettlementShare === null ? 'n/a' : `${Math.round(summary.inSettlementShare * 100)}%`;
  const top = summary.countries
    .slice(0, 12)
    .map((c) => `${c.nameRu} ${c.rounds}`)
    .join(', ');
  return [
    `map ${summary.map}, region ${summary.region}: ${summary.roundsFound} of ${summary.roundsAsked} rounds found`,
    `in a settlement: ${share}; median distance to the nearest town: ${summary.medianNearestTownKm ?? 'n/a'} km`,
    `lookups per round: ${summary.meanLookupsPerRound ?? 'n/a'}; seconds per round: ${summary.meanSecondsPerRound ?? 'n/a'} (slowest ${summary.slowestRoundSeconds ?? 'n/a'})${summary.failures.length > 0 ? ', the failed searches included' : ''}`,
    `countries (${summary.countries.length}): ${top}`,
    ...summary.failures.map((failure) => `failed: ${failure}`),
  ].join('\n');
}

/** The summary of a run, and whether a key, quota or network error cut it short. */
interface SampleRun {
  summary: SampleSummary;
  cutShort: boolean;
}

async function run(args: SampleArgs, serverKey: string): Promise<SampleRun> {
  const metadata = createMetadataClient({ serverKey });
  const service = createLocationService({
    serverKey,
    metadata,
    rng: args.seed === null ? undefined : seededRng(args.seed),
  });
  const rounds: SampledRound[] = [];
  const failures: string[] = [];
  const failedSearches: SearchCost[] = [];
  let played: string[] = [];
  let cutShort = false;
  for (let i = 1; i <= args.rounds; i += 1) {
    if ((i - 1) % args.matchRounds === 0) played = [];
    const lookupsBefore = metadata.lookupCount();
    const startedAt = performance.now();
    try {
      const target = await service.prepareRoundLocation({
        map: args.map,
        region: args.region,
        excludeCountryIds: played,
      });
      played.push(target.countryId);
      const seconds = (performance.now() - startedAt) / 1000;
      const round = describeRound(target, metadata.lookupCount() - lookupsBefore, seconds);
      rounds.push(round);
      if (!args.json) console.log(formatRound(i, round, args.links));
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
      failedSearches.push({
        lookups: metadata.lookupCount() - lookupsBefore,
        seconds: (performance.now() - startedAt) / 1000,
      });
      // A key, quota or network error will not go away on the next round.
      if (err instanceof Error && 'code' in err) {
        cutShort = true;
        break;
      }
    }
  }
  const summary = summarize({
    map: args.map,
    region: args.region,
    roundsAsked: args.rounds,
    rounds,
    failures,
    failedSearches,
  });
  return { summary, cutShort };
}

if (import.meta.main) {
  try {
    const args = parseSampleArgs(process.argv.slice(2));
    if (args.help) {
      console.log(SAMPLE_HELP);
      process.exit(0);
    }
    const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY?.trim() ?? '';
    if (!serverKey) {
      console.error('maps:sample: GOOGLE_MAPS_SERVER_KEY is not set; put it into .env');
      process.exit(2);
    }
    const { summary, cutShort } = await run(args, serverKey);
    console.log(args.json ? JSON.stringify(summary, null, 2) : `\n${formatSummary(summary)}`);
    process.exit(sampleExitCode(summary.roundsFound, cutShort));
  } catch (err) {
    if (!(err instanceof SampleArgsError)) throw err;
    console.error(`maps:sample: ${err.message}`);
    process.exit(1);
  }
}
