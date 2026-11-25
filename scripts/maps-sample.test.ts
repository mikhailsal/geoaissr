import { expect, test } from 'bun:test';
import type { RoundTarget } from '../server/engine/types.ts';
import { SAMPLE_HELP, SampleArgsError, parseSampleArgs } from './maps-sample/args.ts';
import { describeRound, summarize, type SampledRound } from './maps-sample/stats.ts';

function target(lat: number, lng: number): RoundTarget {
  return {
    panoId: 'pano',
    lat,
    lng,
    countryId: 'FRA',
    countryNameRu: 'Франция',
    map: 'standard',
    region: 'world',
    fakeSceneIndex: 0,
  };
}

function sampled(over: Partial<SampledRound>): SampledRound {
  return {
    countryId: 'FRA',
    countryNameRu: 'Франция',
    lat: 0,
    lng: 0,
    nearestTownKm: 1,
    nearestTownPopulation: 20000,
    inSettlement: true,
    lookups: 1,
    seconds: 1,
    ...over,
  };
}

const empty = {
  map: 'standard',
  region: 'world',
  roundsAsked: 3,
  failures: [],
  failedSearches: [],
};

// Value: protects=defaults of the sample tool; fails_when=a default value changes;
// why_new=there was no maps-sample test at all; seam=none; no_claim=the CLI wiring (parser only)
test('parseSampleArgs returns the defaults for no arguments', () => {
  expect(parseSampleArgs([])).toEqual({
    map: 'standard',
    region: 'world',
    rounds: 20,
    matchRounds: 5,
    seed: null,
    links: false,
    json: false,
    help: false,
  });
  expect(SAMPLE_HELP).toContain('--rounds');
});

// Value: protects=every flag is read into its field; fails_when=a flag is renamed or mapped to the wrong field;
// why_new=there was no maps-sample test at all; seam=none; no_claim=the CLI wiring (parser only)
test('parseSampleArgs reads every flag', () => {
  const args = parseSampleArgs([
    '--map',
    'wild',
    '--region',
    'country:FRA',
    '--rounds',
    '50',
    '--match',
    '3',
    '--seed',
    '42',
    '--links',
    '--json',
    '--help',
  ]);
  expect(args).toEqual({
    map: 'wild',
    region: 'country:FRA',
    rounds: 50,
    matchRounds: 3,
    seed: 42,
    links: true,
    json: true,
    help: true,
  });
  expect(parseSampleArgs(['-h']).help).toBe(true);
});

// Value: protects=a known country region is accepted and an unknown one rejected; fails_when=the region check is loosened;
// why_new=there was no maps-sample test at all; seam=none; no_claim=the CLI wiring (parser only)
test('parseSampleArgs validates the region', () => {
  expect(parseSampleArgs(['--region', 'country:FRA']).region).toBe('country:FRA');
  expect(() => parseSampleArgs(['--region', 'country:ZZZ'])).toThrow(SampleArgsError);
  expect(() => parseSampleArgs(['--region'])).toThrow(SampleArgsError);
});

// Value: protects=bad maps, flags and numbers are rejected with SampleArgsError; fails_when=any of them is accepted;
// why_new=there was no maps-sample test at all; seam=none; no_claim=the CLI wiring (parser only)
test('parseSampleArgs rejects an unknown map, an unknown flag and bad numbers', () => {
  expect(() => parseSampleArgs(['--map', 'nowhere'])).toThrow(SampleArgsError);
  expect(() => parseSampleArgs(['--bogus', '1'])).toThrow('Unknown flag "--bogus"');
  expect(() => parseSampleArgs(['--rounds', 'abc'])).toThrow(SampleArgsError);
  expect(() => parseSampleArgs(['--rounds', '0'])).toThrow(SampleArgsError);
  expect(() => parseSampleArgs(['--rounds', '501'])).toThrow(SampleArgsError);
  expect(() => parseSampleArgs(['--rounds', '2.5'])).toThrow(SampleArgsError);
  expect(() => parseSampleArgs(['--match', '21'])).toThrow(SampleArgsError);
  expect(() => parseSampleArgs(['--seed', '-1'])).toThrow(SampleArgsError);
  expect(() => parseSampleArgs(['--rounds'])).toThrow(SampleArgsError);
});

// Value: protects=a round in the centre of Paris is inside a settlement with a known nearest town; fails_when=the settlement test or the lookup breaks;
// why_new=there was no maps-sample test at all; seam=none; no_claim=exact distances (real places dataset)
test('describeRound marks the centre of Paris as inside a settlement', () => {
  const round = describeRound(target(48.8566, 2.3522), 7, 2.5);
  expect(round.inSettlement).toBe(true);
  expect(round.nearestTownKm).not.toBeNull();
  expect(round.nearestTownKm ?? 99).toBeLessThan(5);
  expect(round.nearestTownPopulation ?? 0).toBeGreaterThan(15_000);
  expect(round).toMatchObject({ lookups: 7, seconds: 2.5, countryId: 'FRA', lat: 48.8566 });
});

// Value: protects=a point in the middle of the Sahara is not inside a settlement; fails_when=the settlement test accepts far towns;
// why_new=there was no maps-sample test at all; seam=none; no_claim=exact distances (real places dataset)
test('describeRound marks the middle of the Sahara as outside any settlement', () => {
  const round = describeRound(target(23, 12), 1, 1);
  expect(round.inSettlement).toBe(false);
  expect(round.nearestTownKm === null || round.nearestTownKm > 20).toBe(true);
});

// Value: protects=shares, medians, means, slowest round and country order in the summary; fails_when=any statistic or the sort changes;
// why_new=there was no maps-sample test at all; seam=none; no_claim=real round data (inline rounds)
test('summarize computes shares, medians, means and country counts', () => {
  const rounds = [
    sampled({ countryNameRu: 'Франция', nearestTownKm: 1, lookups: 2, seconds: 1 }),
    sampled({
      countryNameRu: 'Италия',
      nearestTownKm: 9,
      inSettlement: false,
      lookups: 4,
      seconds: 5,
    }),
    sampled({ countryNameRu: 'Италия', nearestTownKm: null, inSettlement: false, seconds: 3 }),
  ];
  const summary = summarize({ ...empty, rounds, failures: ['no coverage'] });
  expect(summary).toMatchObject({
    map: 'standard',
    roundsAsked: 3,
    roundsFound: 3,
    failures: ['no coverage'],
    inSettlementShare: 0.33,
    medianNearestTownKm: 9,
    meanLookupsPerRound: 2.33,
    meanSecondsPerRound: 3,
    slowestRoundSeconds: 5,
  });
  expect(summary.countries).toEqual([
    { nameRu: 'Италия', rounds: 2 },
    { nameRu: 'Франция', rounds: 1 },
  ]);
});

// Value: protects=the median of an odd count is the middle value; fails_when=the odd branch picks another element;
// why_new=there was no maps-sample test at all; seam=none; no_claim=real round data (inline rounds)
test('summarize takes the middle value as the median for an odd count', () => {
  const rounds = [9, 1, 4].map((km) => sampled({ nearestTownKm: km }));
  expect(summarize({ ...empty, rounds }).medianNearestTownKm).toBe(4);
});

// Value: protects=a round with no town within the search bound stays in the median; fails_when=far rounds are dropped and a mostly remote sample reports a small median;
// why_new=the median left out the rounds beyond the bound; seam=none; no_claim=the exact distance beyond 300 km (the bound stands for it)
test('summarize counts a round far from any town at the search bound', () => {
  const rounds = [1, null, null].map((km) => sampled({ nearestTownKm: km }));
  expect(summarize({ ...empty, rounds }).medianNearestTownKm).toBe(300);
});

// Value: protects=a search that found no round counts in the cost of a sample; fails_when=the failed search is dropped and a region where every second search spends its 90 lookups reports one lookup a round;
// why_new=the cost was taken over the rounds found only; seam=none; no_claim=the live lookup counter (inline costs)
test('summarize counts the lookups and the time of a search that found no round', () => {
  const summary = summarize({
    ...empty,
    rounds: [sampled({ lookups: 1, seconds: 0.5 })],
    failures: ['no panorama in 90 lookups'],
    failedSearches: [{ lookups: 90, seconds: 20 }],
  });
  expect(summary).toMatchObject({
    roundsFound: 1,
    meanLookupsPerRound: 45.5,
    meanSecondsPerRound: 10.25,
    slowestRoundSeconds: 20,
  });
});

// Value: protects=an empty list gives null statistics and no countries; fails_when=an empty list yields NaN or throws;
// why_new=there was no maps-sample test at all; seam=none; no_claim=real round data (inline rounds)
test('summarize returns null statistics for an empty list', () => {
  const summary = summarize({ ...empty, rounds: [], failures: ['a', 'b'] });
  expect(summary).toEqual({
    map: 'standard',
    region: 'world',
    roundsAsked: 3,
    roundsFound: 0,
    failures: ['a', 'b'],
    inSettlementShare: null,
    medianNearestTownKm: null,
    meanLookupsPerRound: null,
    meanSecondsPerRound: null,
    slowestRoundSeconds: null,
    countries: [],
  });
});
