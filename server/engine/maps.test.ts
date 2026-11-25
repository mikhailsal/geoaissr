import { expect, test } from 'bun:test';
import type { SettingsFile } from '../../shared/storage-schemas.ts';
import { buildQuotaMetric } from '../storage/quota.ts';
import { reduce } from './reduce.ts';
import { createInitialRoomState, type RoomState, type RoundTarget } from './types.ts';
import { projectView } from './view.ts';

function makeRoom(settings: Partial<SettingsFile> = {}): RoomState {
  const room = createInitialRoomState({
    matchId: 'm-maps',
    fakeMode: true,
    settings: {
      version: 2,
      map: 'standard',
      region: 'world',
      rounds: 1,
      roundDurationSec: 90,
      moveEnabled: true,
      aiWaitWindowSec: 30,
      showMatchStandings: true,
      bots: [],
      ...settings,
    },
    quotaSummary: {
      metrics: {
        static: buildQuotaMetric(0, 8000),
        pano: buildQuotaMetric(0, 4000),
        map: buildQuotaMetric(0, 8000),
      },
      staticUsed: 0,
      staticCeiling: 8000,
      staticWorstCase: 10,
      panoUsed: 0,
      panoCeiling: 4000,
      panoWorstCase: 2,
      mapUsed: 0,
      mapCeiling: 8000,
      mapWorstCase: 2,
      needsResetConfirm: false,
      sufficient: true,
    },
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [],
  });
  return reduce(
    room,
    { type: 'player_join', playerId: 'h', secret: 's', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
}

// Value: protects=the host's choice of a map and a one-country region is saved and shown to every player; fails_when=the patch drops the map or the view keeps the old one;
// why_new=the lobby had a region only; seam=none; no_claim=the lobby select itself (engine only)
test('the lobby saves the map and a one-country region and shows them', () => {
  const s = makeRoom();
  const out = reduce(
    s,
    { type: 'update_lobby', playerId: 'h', patch: { map: 'capitals', region: 'country:FRA' } },
    200,
  );
  expect(out.ack).toBe('ok');
  expect(out.state.settings.map).toBe('capitals');
  expect(out.state.settings.region).toBe('country:FRA');
  expect(out.effects).toEqual([{ type: 'save_settings', settings: out.state.settings }]);
  const view = projectView(out.state, 'h');
  expect(view.map).toBe('capitals');
  expect(view.region).toBe('country:FRA');
  expect(view.startBlockedReasons).toEqual([]);
});

// Value: protects=a region with the right form but an unknown country keeps the old region, and the host reads why; fails_when=a forged or stale country id reaches the sampler and the round search throws, or the select snaps back without a word;
// why_new=regions were a closed list the schema checked; seam=none; no_claim=the websocket schema (engine only)
test('a patch with an unknown country keeps the old region and tells the host', () => {
  const s = makeRoom({ region: 'asia' });
  const out = reduce(
    s,
    { type: 'update_lobby', playerId: 'h', patch: { map: 'cities', region: 'country:ZZZ' } },
    200,
  );
  expect(out.state.settings.region).toBe('asia');
  expect(out.state.settings.map).toBe('cities');
  expect(out.state.settingsNotice).toContain('Такого региона нет');
  const known = reduce(
    s,
    { type: 'update_lobby', playerId: 'h', patch: { region: 'country:JPN' } },
    200,
  );
  expect(known.state.settings.region).toBe('country:JPN');
  expect(known.state.settingsNotice).toBeUndefined();
  // One patch corrected twice: the host reads about the duration and about the region.
  const withBot = makeRoom({
    region: 'asia',
    bots: [
      {
        id: 'b1',
        name: 'Бот',
        color: 'p-1',
        enabled: true,
        harness: 'claude',
        model: 'sonnet',
        effort: 'low',
        moveLimit: 0,
        imageSize: 400,
        budgetSec: 90,
        difficultyPreset: 'amateur',
        personalityPreset: 'neutral',
        personalityText: '',
      },
    ],
  });
  const both = reduce(
    withBot,
    { type: 'update_lobby', playerId: 'h', patch: { roundDurationSec: 30, region: 'country:ZZZ' } },
    200,
  );
  expect(both.state.settings.roundDurationSec).toBe(60);
  expect(both.state.settings.region).toBe('asia');
  expect(both.state.settingsNotice).toContain('не может быть меньше 60 с');
  expect(both.state.settingsNotice).toContain('Такого региона нет');
});

// Value: protects=a match cannot start on a map that has no places in the chosen region, and the host reads why; fails_when=the start goes through and the round search fails after the countdown;
// why_new=every region had places before; seam=none; no_claim=the disabled option in the select (engine only)
test('an empty map and region combination blocks the start with a reason', () => {
  const s = makeRoom({ map: 'highlands', region: 'europe' });
  const view = projectView(s, 'h');
  expect(view.startBlockedReasons).toEqual([
    'На карте «Высокогорье» нет мест в регионе «Европа»: выберите другую карту или регион',
  ]);
  const blocked = reduce(s, { type: 'start_match', playerId: 'h' }, 300);
  expect(blocked.ack).toBe('invalid');
  expect(blocked.state.phase).toBe('LOBBY');
  const fixed = reduce(
    s,
    { type: 'update_lobby', playerId: 'h', patch: { region: 'south_america' } },
    301,
  ).state;
  expect(projectView(fixed, 'h').startBlockedReasons).toEqual([]);
  expect(reduce(fixed, { type: 'start_match', playerId: 'h' }, 302).ack).toBe('ok');
});

const TARGET: RoundTarget = {
  panoId: 'pano-lima',
  lat: -12.05,
  lng: -77.04,
  countryId: 'PER',
  countryNameRu: 'Перу',
  map: 'capitals',
  region: 'south_america',
  fakeSceneIndex: 0,
};

// Value: protects=the round search is asked for the map of the match, and the finished match is stored with it; fails_when=the map is lost between the lobby and the search or the record;
// why_new=a match had no map; seam=none; no_claim=the search itself (effects only)
test('a match asks for rounds of its map and records the map', () => {
  let s = makeRoom({ map: 'capitals', region: 'south_america' });
  const start = reduce(s, { type: 'start_match', playerId: 'h' }, 1000);
  const prepare = start.effects.find((effect) => effect.type === 'prepare_round');
  expect(prepare).toMatchObject({
    type: 'prepare_round',
    map: 'capitals',
    region: 'south_america',
    roundNumber: 1,
    excludeCountryIds: [],
  });
  s = start.state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: s.matchId, gen: s.gen, roundNumber: 1, target: TARGET },
    1100,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  s = reduce(s, { type: 'countdown_done', matchId: s.matchId, gen: s.gen }, 4200).state;
  s = reduce(
    s,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: -12, lng: -77 },
    5000,
  ).state;
  const done = reduce(s, { type: 'next_round', playerId: 'h', roundNumber: 1 }, 6000);
  const record = done.effects.find((effect) => effect.type === 'append_match_record');
  if (record?.type !== 'append_match_record') throw new Error('missing match record');
  expect(record.record.version).toBe(2);
  expect(record.record.map).toBe('capitals');
  expect(record.record.region).toBe('south_america');
});
