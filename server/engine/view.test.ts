import { expect, test } from 'bun:test';
import type { HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { SettingsFile } from '../../shared/storage-schemas.ts';
import { reduce } from './reduce.ts';
import { createInitialRoomState, type RoomState, type RoundTarget } from './types.ts';
import { projectView } from './view.ts';

function makeBaseRoom(): RoomState {
  const settings: SettingsFile = {
    version: 1,
    region: 'world',
    rounds: 1,
    roundDurationSec: 90,
    moveEnabled: true,
    aiWaitWindowSec: 30,
    bots: [],
  };
  const harnesses: HarnessCatalogEntry[] = [
    { id: 'claude', available: true, readsOwnerFiles: false, models: ['haiku'] },
  ];
  return createInitialRoomState({
    matchId: 'm-view',
    fakeMode: false,
    settings,
    quotaSummary: {
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
    availableHarnesses: harnesses,
  });
}

const TARGET: RoundTarget = {
  panoId: 'secret-pano',
  lat: 48.8566,
  lng: 2.3522,
  countryId: '250',
  countryNameRu: 'Франция',
  region: 'world',
  fakeSceneIndex: 0,
};

test('active view leaks neither target coordinates nor other players pins or bot guesses', () => {
  let s = makeBaseRoom();
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  s = reduce(
    s,
    {
      type: 'player_join',
      playerId: 'g',
      secret: 's2',
      name: 'Гость',
      color: 'p-2',
      isHost: false,
    },
    101,
  ).state;
  s = reduce(s, { type: 'add_bot', playerId: 'h' }, 102).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: 'm-view', gen: s.gen, roundNumber: 1, target: TARGET },
    1100,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'g', roundNumber: 1 }, 1201).state;
  s = reduce(s, { type: 'countdown_done', matchId: 'm-view', gen: s.gen }, 4201).state;
  s = reduce(
    s,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 48.85, lng: 2.35 },
    5000,
  ).state;
  const botId = s.settings.bots[0]?.id ?? '';
  s = reduce(
    s,
    {
      type: 'bot_guess_recorded',
      matchId: 'm-view',
      gen: s.gen,
      roundNumber: 1,
      botId,
      guess: { lat: 48.9, lng: 2.4, explanation: 'Секретная мысль', quip: 'Секрет' },
    },
    5500,
  ).state;

  const guestView = projectView(s, 'g', 6000);
  const serialized = JSON.stringify(guestView);
  expect(guestView.phase).toBe('ROUND_ACTIVE');
  expect(serialized).not.toContain('48.8566');
  expect(serialized).not.toContain('2.3522');
  expect(serialized).not.toContain('Франция');
  expect(serialized).not.toContain('48.85');
  expect(serialized).not.toContain('Секретная мысль');
  expect(guestView.active?.myPin).toBeNull();
  expect(guestView.players.find((p) => p.id === 'h')?.confirmed).toBe(true);
});

test('startBlockedReasons blocks quota exceeded and host mapsError in real mode', () => {
  let s = makeBaseRoom();
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  s = reduce(
    s,
    {
      type: 'client_error',
      playerId: 'h',
      source: 'maps_js',
      code: 'ApiNotActivatedMapError',
      message: 'API disabled',
    },
    200,
  ).state;
  s = reduce(
    s,
    {
      type: 'quota_updated',
      quotaSummary: { ...s.quotaSummary, sufficient: false, exceedsMessage: 'Недостаточно квот' },
    },
    300,
  ).state;

  const view = projectView(s, 'h', 300);
  expect(view.startBlockedReasons.length).toBe(2);
  expect(reduce(s, { type: 'start_match', playerId: 'h' }, 301).ack).toBe('invalid');
});

test('round results and final screen reveal scores and perRound botCards', () => {
  let s = makeBaseRoom();
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  s = reduce(s, { type: 'add_bot', playerId: 'h' }, 102).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: 'm-view', gen: s.gen, roundNumber: 1, target: TARGET },
    1100,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  s = reduce(s, { type: 'countdown_done', matchId: 'm-view', gen: s.gen }, 4200).state;
  const botId = s.settings.bots[0]?.id ?? '';
  s = reduce(
    s,
    {
      type: 'bot_guess_recorded',
      matchId: 'm-view',
      gen: s.gen,
      roundNumber: 1,
      botId,
      guess: { lat: 48.8566, lng: 2.3522, explanation: 'Эйфелева башня' },
    },
    4500,
  ).state;
  s = reduce(
    s,
    {
      type: 'bot_finished',
      matchId: 'm-view',
      gen: s.gen,
      roundNumber: 1,
      botId,
      aborted: false,
      reason: 'done',
    },
    4600,
  ).state;
  s = reduce(
    s,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 48.0, lng: 2.0 },
    5000,
  ).state;
  expect(s.phase).toBe('ROUND_RESULTS');

  const resView = projectView(s, 'h', 5500);
  expect(resView.results?.countryNameRu).toBe('Франция');
  expect(resView.results?.entries.find((e) => e.isAi)?.roundScore).toBe(5000);

  s = reduce(s, { type: 'next_round', playerId: 'h', roundNumber: 1 }, 6000).state;
  const finalView = projectView(s, 'h', 6000);
  expect(finalView.phase).toBe('FINAL');
  expect(finalView.final?.standings[0]?.isAi).toBe(true);
  expect(finalView.final?.standings[0]?.perRound[0]?.botCard?.explanation).toBe('Эйфелева башня');
});
