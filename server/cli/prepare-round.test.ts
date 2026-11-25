import { expect, test } from 'bun:test';
import type { RoomState, RoundTarget } from '../engine/types.ts';
import type { LocationService, RoundLocationRequest } from '../location.ts';
import { createPrepareRound, type PrepareRoundRequest } from './prepare-round.ts';

const TARGET: RoundTarget = {
  panoId: 'pano-1',
  lat: 48.85,
  lng: 2.35,
  countryId: 'FRA',
  countryNameRu: 'Франция',
  map: 'cities',
  region: 'europe',
  fakeSceneIndex: 0,
};

const REQUEST: PrepareRoundRequest = {
  matchId: 'm1',
  gen: 3,
  roundNumber: 2,
  map: 'cities',
  region: 'europe',
  excludeCountryIds: ['DEU'],
  withBots: true,
};

function harness(state: () => Partial<RoomState> | undefined) {
  const asked: RoundLocationRequest[] = [];
  const framed: RoundTarget[] = [];
  const locationService: LocationService = {
    prepareRoundLocation: (opts) => {
      asked.push(opts);
      return Promise.resolve(TARGET);
    },
    queryMetadata: () => Promise.resolve(null),
  };
  const prepare = createPrepareRound({
    locationService,
    prepareStartViews: (target) => {
      framed.push(target);
      return Promise.resolve();
    },
    getState: () => state() as RoomState | undefined,
  });
  return { prepare, asked, framed };
}

// Value: protects=the round search gets the map, the region and the played countries of the request; fails_when=the map is dropped on the way from the engine to the location service;
// why_new=the wiring moved out of start-runtime and gained the map; seam=none; no_claim=the search itself (location service double)
test('prepare round passes the map and region on and fetches the bots frames', async () => {
  const { prepare, asked, framed } = harness(() => ({
    matchId: 'm1',
    gen: 3,
    phase: 'ROUND_LOADING',
  }));
  expect(await prepare(REQUEST)).toBe(TARGET);
  expect(asked).toEqual([{ map: 'cities', region: 'europe', excludeCountryIds: ['DEU'] }]);
  expect(framed).toEqual([TARGET]);
});

// Value: protects=start frames, which cost Street View Static quota, are not requested for a round nobody waits for; fails_when=a match stopped or restarted during a long search still pays for the frames;
// why_new=a round search could not take long before the retro and north maps; seam=none; no_claim=the engine dropping the stale result (covered by its own tests)
test('prepare round skips the frames when the match moved on during the search', async () => {
  const cases: (Partial<RoomState> | undefined)[] = [
    { matchId: 'm2', gen: 3, phase: 'ROUND_LOADING' },
    { matchId: 'm1', gen: 4, phase: 'ROUND_LOADING' },
    { matchId: 'm1', gen: 3, phase: 'LOBBY' },
  ];
  for (const state of cases) {
    const { prepare, framed } = harness(() => state);
    expect(await prepare(REQUEST)).toBe(TARGET);
    expect(framed).toEqual([]);
  }
  const noBots = harness(() => ({ matchId: 'm1', gen: 3, phase: 'ROUND_LOADING' }));
  await noBots.prepare({ ...REQUEST, withBots: false });
  expect(noBots.framed).toEqual([]);
  // Before the room exists there is nothing to compare with: the frames are fetched.
  const early = harness(() => undefined);
  await early.prepare(REQUEST);
  expect(early.framed).toEqual([TARGET]);
});
