import { buildQuotaMetric } from '../storage/quota.ts';
import { expect, test } from 'bun:test';
import { COUNTDOWN_MS, type HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { SettingsFile } from '../../shared/storage-schemas.ts';
import { reduce } from './reduce.ts';
import { createInitialRoomState, type RoomState, type RoundTarget } from './types.ts';

function makeSettings(overrides: Partial<SettingsFile> = {}): SettingsFile {
  return {
    version: 2,
    map: 'standard',
    region: 'world',
    rounds: 2,
    roundDurationSec: 90,
    moveEnabled: true,
    aiWaitWindowSec: 30,
    showMatchStandings: true,
    bots: [],
    ...overrides,
  };
}

function makeHarnesses(): HarnessCatalogEntry[] {
  return [
    { id: 'claude', available: true, readsOwnerFiles: false, models: ['haiku', 'sonnet'] },
    { id: 'codex', available: true, readsOwnerFiles: false, models: ['gpt-6-luna'] },
    {
      id: 'agy',
      available: false,
      reason: 'не авторизован',
      readsOwnerFiles: true,
      models: ['gemini-3.8-flash-low'],
    },
  ];
}

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
  const base = createInitialRoomState({
    matchId: 'm1',
    fakeMode: false,
    settings: makeSettings(),
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
    availableHarnesses: makeHarnesses(),
  });
  return { ...base, ...overrides };
}

function makeTarget(round = 1): RoundTarget {
  return {
    panoId: `pano-${round}`,
    lat: 55.75,
    lng: 37.61,
    countryId: round === 1 ? '643-eu' : '250',
    countryNameRu: round === 1 ? 'Россия' : 'Франция',
    map: 'standard',
    region: 'world',
    fakeSceneIndex: round - 1,
  };
}

test('addBot enforces >= 60s duration and max 3 bots', () => {
  let s = makeRoom({ settings: makeSettings({ roundDurationSec: 30 }) });
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  const r1 = reduce(s, { type: 'add_bot', playerId: 'h' }, 101);
  expect(r1.ack).toBe('ok');
  expect(r1.state.settings.bots.length).toBe(1);
  expect(r1.state.settings.roundDurationSec).toBe(60);
  expect(r1.state.settingsNotice).toBeDefined();

  s = reduce(r1.state, { type: 'add_bot', playerId: 'h' }, 102).state;
  s = reduce(s, { type: 'add_bot', playerId: 'h' }, 103).state;
  expect(s.settings.bots.length).toBe(3);
  const r4 = reduce(s, { type: 'add_bot', playerId: 'h' }, 104);
  expect(r4.ack).toBe('invalid');
  expect(r4.state.settings.bots.length).toBe(3);
});

test('non-host cannot mutate lobby or start match', () => {
  let s = makeRoom();
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
  expect(reduce(s, { type: 'update_lobby', playerId: 'g', patch: { rounds: 5 } }, 102).ack).toBe(
    'forbidden',
  );
  const hostUpdate = reduce(
    s,
    { type: 'update_lobby', playerId: 'h', patch: { showMatchStandings: false } },
    103,
  );
  expect(hostUpdate.ack).toBe('ok');
  expect(hostUpdate.state.settings.showMatchStandings).toBe(false);
  expect(hostUpdate.effects).toEqual([
    { type: 'save_settings', settings: hostUpdate.state.settings },
  ]);
  expect(reduce(s, { type: 'start_match', playerId: 'g' }, 104).ack).toBe('forbidden');
});

test('loading waits for connected humans and the full audio intro before counting down', () => {
  let s = makeRoom();
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
  const start = reduce(s, { type: 'start_match', playerId: 'h' }, 1000);
  expect(start.ack).toBe('ok');
  expect(start.state.phase).toBe('ROUND_LOADING');

  const prep = reduce(
    start.state,
    {
      type: 'round_prepared',
      matchId: 'm1',
      gen: start.state.gen,
      roundNumber: 1,
      target: makeTarget(1),
    },
    1100,
  );
  expect(prep.effects.some((e) => e.type === 'schedule_countdown')).toBe(false);

  const p1 = reduce(prep.state, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200);
  expect(p1.effects.some((e) => e.type === 'schedule_countdown')).toBe(false);

  const p2 = reduce(p1.state, { type: 'pano_loaded', playerId: 'g', roundNumber: 1 }, 1300);
  const countdownStartsAt = 7_800;
  const countdownEndsAt = countdownStartsAt + COUNTDOWN_MS;
  expect(p2.state.loadingOrActive?.countdownStartsAt).toBe(countdownStartsAt);
  expect(p2.effects).toContainEqual({
    type: 'schedule_countdown',
    matchId: 'm1',
    gen: p2.state.gen,
    atMs: countdownEndsAt,
  });

  const active = reduce(
    p2.state,
    { type: 'countdown_done', matchId: 'm1', gen: p2.state.gen },
    countdownEndsAt,
  );
  expect(active.state.phase).toBe('ROUND_ACTIVE');
  expect(active.effects.some((e) => e.type === 'release_bot_observe')).toBe(true);
});

test('countdown starts immediately when panorama readiness follows the audio intro', () => {
  let s = makeRoom();
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: 'm1', gen: s.gen, roundNumber: 1, target: makeTarget(1) },
    7000,
  ).state;

  const readyAt = 8_000;
  const ready = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, readyAt);
  expect(ready.state.loadingOrActive?.countdownStartsAt).toBe(readyAt);
  expect(ready.effects).toContainEqual({
    type: 'schedule_countdown',
    matchId: 'm1',
    gen: s.gen,
    atMs: readyAt + COUNTDOWN_MS,
  });
});

test('stale gen timer ticks are dropped cleanly', () => {
  let s = makeRoom();
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  const staleGen = s.gen;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: 'm1', gen: s.gen, roundNumber: 1, target: makeTarget(1) },
    1100,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  s = reduce(s, { type: 'countdown_done', matchId: 'm1', gen: s.gen }, 4200).state;

  const staleTick = reduce(
    s,
    { type: 'pano_load_timeout', matchId: 'm1', gen: staleGen - 1 },
    5000,
  );
  expect(staleTick.state).toBe(s);
  const wrongMatch = reduce(
    s,
    { type: 'deadline_tick', matchId: 'other', gen: s.gen, kind: 'round' },
    5000,
  );
  expect(wrongMatch.state).toBe(s);
});

test('all humans confirmed with thinking bot waits at least 60s from start or aiWaitWindowSec', () => {
  let s = makeRoom({ settings: makeSettings({ roundDurationSec: 120, aiWaitWindowSec: 15 }) });
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  s = reduce(s, { type: 'add_bot', playerId: 'h' }, 110).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: 'm1', gen: s.gen, roundNumber: 1, target: makeTarget(1) },
    1100,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  s = reduce(s, { type: 'countdown_done', matchId: 'm1', gen: s.gen }, 10_000).state;

  const guess = reduce(
    s,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 55.7, lng: 37.6 },
    15_000,
  );
  expect(guess.ack).toBe('ok');
  expect(guess.state.phase).toBe('ROUND_ACTIVE');
  expect(guess.state.loadingOrActive?.endsAt).toBe(70_000);
  // Bots must read the shortened end, not their full slot budget.
  expect(guess.effects).toContainEqual({
    type: 'set_bot_round_deadline',
    matchId: 'm1',
    gen: guess.state.gen,
    roundNumber: 1,
    atMs: 70_000,
  });

  const botGuess = reduce(
    guess.state,
    {
      type: 'bot_guess_recorded',
      matchId: 'm1',
      gen: guess.state.gen,
      roundNumber: 1,
      botId: guess.state.settings.bots[0]?.id ?? '',
      guess: { lat: 55.8, lng: 37.5, explanation: 'Берёзы' },
    },
    20_000,
  );
  const botDone = reduce(
    botGuess.state,
    {
      type: 'bot_finished',
      matchId: 'm1',
      gen: botGuess.state.gen,
      roundNumber: 1,
      botId: botGuess.state.settings.bots[0]?.id ?? '',
      aborted: false,
      reason: 'done',
    },
    21_000,
  );
  expect(botDone.state.phase).toBe('ROUND_RESULTS');
  expect(botDone.state.results?.humanVsAi.visible).toBe(true);
});

test('round results stay until the host presses next; no auto-advance timer', () => {
  let s = makeRoom();
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: 'm1', gen: s.gen, roundNumber: 1, target: makeTarget(1) },
    1100,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  s = reduce(s, { type: 'countdown_done', matchId: 'm1', gen: s.gen }, 2000).state;
  const ended = reduce(
    s,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 55, lng: 37 },
    5000,
  );
  s = ended.state;
  expect(s.phase).toBe('ROUND_RESULTS');
  expect(ended.effects.some((e) => e.type.startsWith('schedule_results'))).toBe(false);

  const guest = reduce(
    s,
    {
      type: 'player_join',
      playerId: 'g',
      secret: 's2',
      name: 'Гость',
      color: 'p-2',
      isHost: false,
    },
    6000,
  ).state;
  const byGuest = reduce(guest, { type: 'next_round', playerId: 'g', roundNumber: 1 }, 7000);
  expect(byGuest.ack).toBe('forbidden');
  expect(byGuest.state.phase).toBe('ROUND_RESULTS');

  const byHost = reduce(guest, { type: 'next_round', playerId: 'h', roundNumber: 1 }, 10 * 60_000);
  expect(byHost.ack).toBe('ok');
  expect(byHost.state.phase).toBe('ROUND_LOADING');
});

test('last human disconnecting in ROUND_LOADING holds countdown and mapsError resets cleanly', () => {
  let s = makeRoom();
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;

  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: 'm1', gen: s.gen, roundNumber: 1, target: makeTarget(1) },
    1100,
  ).state;
  s = reduce(
    s,
    { type: 'client_error', playerId: 'h', source: 'pano', code: 'ZERO_RESULTS', message: 'empty' },
    1150,
  ).state;
  expect(s.players.h?.mapsError).toContain('ZERO_RESULTS');

  const dc = reduce(s, { type: 'player_disconnect', playerId: 'h' }, 1200);
  expect(dc.effects.some((e) => e.type === 'schedule_countdown')).toBe(false);
  const to = reduce(
    dc.state,
    { type: 'pano_load_timeout', matchId: 'm1', gen: dc.state.gen },
    12_000,
  );
  expect(to.effects.some((e) => e.type === 'schedule_countdown')).toBe(false);

  const rec = reduce(to.state, { type: 'player_reconnect', playerId: 'h', isHost: true }, 12_100);
  expect(rec.effects.some((e) => e.type === 'schedule_countdown')).toBe(true);
  const loaded = reduce(
    rec.state,
    { type: 'pano_loaded', playerId: 'h', roundNumber: 1 },
    12_200,
  ).state;
  expect(loaded.players.h?.mapsError).toBeUndefined();

  let fin = reduce(
    loaded,
    { type: 'client_error', playerId: 'h', source: 'map', code: 'E', message: 'm' },
    12_300,
  ).state;
  fin = reduce(fin, { type: 'end_match', playerId: 'h' }, 12_400).state;
  fin = reduce(fin, { type: 'play_again', playerId: 'h' }, 12_500).state;
  expect(fin.players.h?.mapsError).toBeUndefined();
});
