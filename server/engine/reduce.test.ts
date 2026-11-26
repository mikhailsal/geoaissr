import { buildQuotaMetric } from '../storage/quota.ts';
import { expect, test } from 'bun:test';
import {
  COUNTDOWN_MS,
  DISCONNECTED_GUEST_GRACE_MS,
  type HarnessCatalogEntry,
} from '../../shared/protocol.ts';
import type { SettingsFile } from '../../shared/storage-schemas.ts';
import { reduce } from './reduce.ts';
import { projectView } from './view.ts';
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
    pushEnabled: false,
    pushSeconds: 15,
    allowBotPush: true,
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

function startActiveBotRound(settings: SettingsFile): RoomState {
  let state = makeRoom({ settings });
  state = reduce(
    state,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
  state = reduce(state, { type: 'add_bot', playerId: 'h' }, 110).state;
  state = reduce(state, { type: 'start_match', playerId: 'h' }, 1000).state;
  state = reduce(
    state,
    {
      type: 'round_prepared',
      matchId: 'm1',
      gen: state.gen,
      roundNumber: 1,
      target: makeTarget(1),
    },
    1100,
  ).state;
  state = reduce(state, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  return reduce(state, { type: 'countdown_done', matchId: 'm1', gen: state.gen }, 10_000).state;
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
    {
      type: 'update_lobby',
      playerId: 'h',
      patch: { showMatchStandings: false, pushEnabled: true, pushSeconds: 7, allowBotPush: false },
    },
    103,
  );
  expect(hostUpdate.ack).toBe('ok');
  expect(hostUpdate.state.settings.showMatchStandings).toBe(false);
  expect(hostUpdate.state.settings.pushEnabled).toBe(true);
  expect(hostUpdate.state.settings.pushSeconds).toBe(7);
  expect(hostUpdate.state.settings.allowBotPush).toBe(false);
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
  const s = startActiveBotRound(makeSettings({ roundDurationSec: 120, aiWaitWindowSec: 15 }));

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

test('a human confirmation uses the configured push window and never extends the deadline', () => {
  const settings = makeSettings({ pushEnabled: true, pushSeconds: 7, allowBotPush: false });
  let s = makeRoom({ settings });
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
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: 'm1', gen: s.gen, roundNumber: 1, target: makeTarget(1) },
    1100,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'g', roundNumber: 1 }, 1201).state;
  s = reduce(s, { type: 'countdown_done', matchId: 'm1', gen: s.gen }, 10_000).state;

  const confirm = {
    type: 'submit_guess',
    playerId: 'h',
    roundNumber: 1,
    lat: 55.7,
    lng: 37.6,
  } as const;
  const late = reduce(s, confirm, 95_000);
  expect(late.state.loadingOrActive?.endsAt).toBe(100_000);
  expect(late.effects).toEqual([]);

  const first = reduce(s, confirm, 15_000);
  expect(first.state.loadingOrActive?.roundDeadlineAt).toBe(22_000);
  expect(first.state.loadingOrActive?.endsAt).toBe(22_000);
  expect(first.effects).toContainEqual({
    type: 'schedule_deadline',
    matchId: 'm1',
    gen: first.state.gen,
    kind: 'round',
    atMs: 22_000,
  });

  const later = reduce(
    first.state,
    { type: 'submit_guess', playerId: 'g', roundNumber: 1, lat: 55.8, lng: 37.7 },
    20_000,
  );
  expect(later.state.phase).toBe('ROUND_RESULTS');
  expect(later.effects.some((effect) => effect.type === 'schedule_deadline')).toBe(false);
});

test('only a finalized bot guess pushes; bot completion keeps the normal early-end behavior', () => {
  const settings = makeSettings({ pushEnabled: true, pushSeconds: 4, allowBotPush: true });
  const s = startActiveBotRound(settings);
  const botId = s.settings.bots[0]?.id ?? '';

  const botGuess = {
    type: 'bot_guess_recorded',
    matchId: 'm1',
    gen: s.gen,
    roundNumber: 1,
    botId,
    guess: { lat: 55.8, lng: 37.5, explanation: 'Итог' },
  } as const;
  const disabled = reduce(
    { ...s, settings: { ...s.settings, allowBotPush: false } },
    botGuess,
    15_000,
  );
  expect(disabled.state.loadingOrActive?.roundDeadlineAt).toBe(100_000);
  expect(disabled.effects).toEqual([]);

  const draft = reduce(s, { ...botGuess, finalized: false }, 15_000);
  expect(draft.state.loadingOrActive?.roundDeadlineAt).toBe(100_000);
  expect(draft.effects).toEqual([]);

  const final = reduce(draft.state, botGuess, 16_000);
  expect(final.state.phase).toBe('ROUND_ACTIVE');
  expect(final.state.loadingOrActive?.roundDeadlineAt).toBe(20_000);
  expect(final.effects).toContainEqual({
    type: 'set_bot_round_deadline',
    matchId: 'm1',
    gen: final.state.gen,
    roundNumber: 1,
    atMs: 20_000,
  });

  const human = reduce(
    final.state,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 55.7, lng: 37.6 },
    17_000,
  );
  expect(human.state.loadingOrActive?.endsAt).toBe(20_000);
  const finished = reduce(
    human.state,
    {
      type: 'bot_finished',
      matchId: 'm1',
      gen: human.state.gen,
      roundNumber: 1,
      botId,
      aborted: false,
      reason: 'done',
    },
    18_000,
  );
  expect(finished.state.phase).toBe('ROUND_RESULTS');
});

/** A two-human room on the results screen of round 1: host «h» answered, guest «g» joined after. */
function resultsRoomWithGuest(): RoomState {
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

  return reduce(
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
}

test('round results stay until the host presses next; no auto-advance timer', () => {
  const guest = resultsRoomWithGuest();
  const byGuest = reduce(guest, { type: 'next_round', playerId: 'g', roundNumber: 1 }, 7000);
  expect(byGuest.ack).toBe('forbidden');
  expect(byGuest.state.phase).toBe('ROUND_RESULTS');

  // The guest has not pressed «Готов»: the host's plain click is refused until the host confirms.
  const plain = reduce(guest, { type: 'next_round', playerId: 'h', roundNumber: 1 }, 8000);
  expect(plain.ack).toBe('forbidden');
  expect(plain.state).toBe(guest);

  const byHost = reduce(
    guest,
    { type: 'next_round', playerId: 'h', roundNumber: 1, force: true },
    10 * 60_000,
  );
  expect(byHost.ack).toBe('ok');
  expect(byHost.state.phase).toBe('ROUND_LOADING');
});

// Value: protects=«Готов» marks a guest as ready for the host to see and does nothing else: it
// never moves the match on, the host cannot mark themselves, and a click for another round is
// dropped; fails_when=a guest's click starts the next round, or a stale click from the previous
// results screen marks the guest ready on the new one; why_new=the message is new; seam=none;
// no_claim=the host's confirmation dialog (browser test in web/tests/ready-next.spec.ts).
test('a guest marks themselves ready on the results screen without moving the match on', () => {
  let s = resultsRoomWithGuest();
  expect(projectView(s, 'g').results?.readyIds).toEqual([]);

  const ready = reduce(
    s,
    { type: 'ready_next', playerId: 'g', roundNumber: 1, matchId: 'm1' },
    7000,
  );
  expect(ready.ack).toBe('ok');
  expect(ready.effects).toEqual([]);
  s = ready.state;
  expect(s.phase).toBe('ROUND_RESULTS');
  expect(projectView(s, 'h').results?.readyIds).toEqual(['g']);

  const again = reduce(
    s,
    { type: 'ready_next', playerId: 'g', roundNumber: 1, matchId: 'm1' },
    7100,
  );
  expect(again.ack).toBe('ok');
  expect(again.state.results?.readyIds).toEqual(['g']);

  expect(
    reduce(s, { type: 'ready_next', playerId: 'h', roundNumber: 1, matchId: 'm1' }, 7200).ack,
  ).toBe('forbidden');
  expect(
    reduce(s, { type: 'ready_next', playerId: 'x', roundNumber: 1, matchId: 'm1' }, 7200).ack,
  ).toBe('forbidden');
  const stale = reduce(
    s,
    { type: 'ready_next', playerId: 'g', roundNumber: 2, matchId: 'm1' },
    7300,
  );
  expect(stale.ack).toBe('round_over');
  expect(stale.state.results?.readyIds).toEqual(['g']);

  // Everyone connected is ready: the host's plain click starts the next round.
  const go = reduce(s, { type: 'next_round', playerId: 'h', roundNumber: 1 }, 7400);
  expect(go.ack).toBe('ok');
  expect(go.state.phase).toBe('ROUND_LOADING');
});

// Value: protects=a ready click that arrives after the host has left the results screen is
// dropped; fails_when=a late click throws or changes the state of the next round; why_new=the test
// above stays on the live results screen; seam=none; no_claim=none beyond protects.
test('a «Готов» that arrives after the host moved on is dropped', () => {
  const room = resultsRoomWithGuest();
  // A click from the previous match («Ещё раз» starts the rounds from 1 again) is dropped too.
  const old = reduce(
    room,
    { type: 'ready_next', playerId: 'g', roundNumber: 1, matchId: 'm0' },
    6900,
  );
  expect(old.ack).toBe('round_over');
  expect(old.state).toBe(room);

  const moved = reduce(
    room,
    { type: 'next_round', playerId: 'h', roundNumber: 1, force: true },
    7000,
  ).state;
  const late = reduce(
    moved,
    { type: 'ready_next', playerId: 'g', roundNumber: 1, matchId: 'm1' },
    7100,
  );
  expect(late.ack).toBe('round_over');
  expect(late.state).toBe(moved);
});

// Value: protects=«Готов» on the final screen marks a guest for the host and the host's «Ещё раз»
// waits for it as «Дальше» does; fails_when=a guest's click leaves the final screen, the host's
// plain click returns to the lobby over a guest still reading, a click on an earlier final screen
// counts, or the marks survive into the next final; why_new=the final screen had no «Готов»;
// seam=none; no_claim=the host's confirmation dialog (web/tests/ready-next.spec.ts).
test('a guest marks themselves ready on the final screen and the host is held for it', () => {
  const fin = reduce(resultsRoomWithGuest(), { type: 'end_match', playerId: 'h' }, 7000).state;
  expect(fin.phase).toBe('FINAL');
  expect(projectView(fin, 'h').final?.readyIds).toEqual([]);

  const plain = reduce(fin, { type: 'play_again', playerId: 'h' }, 7100);
  expect(plain.ack).toBe('forbidden');
  expect(plain.state).toBe(fin);

  const stale = reduce(fin, { type: 'ready_lobby', playerId: 'g', gen: fin.gen - 1 }, 7200);
  expect(stale.ack).toBe('invalid');
  expect(stale.state).toBe(fin);
  expect(reduce(fin, { type: 'ready_lobby', playerId: 'h', gen: fin.gen }, 7200).ack).toBe(
    'forbidden',
  );

  const ready = reduce(fin, { type: 'ready_lobby', playerId: 'g', gen: fin.gen }, 7300);
  expect(ready.ack).toBe('ok');
  expect(ready.effects).toEqual([]);
  expect(ready.state.phase).toBe('FINAL');
  expect(projectView(ready.state, 'h').final?.readyIds).toEqual(['g']);
  const again = reduce(ready.state, { type: 'ready_lobby', playerId: 'g', gen: fin.gen }, 7350);
  expect(again.ack).toBe('ok');
  expect(again.state).toBe(ready.state);

  const lobby = reduce(ready.state, { type: 'play_again', playerId: 'h' }, 7400);
  expect(lobby.ack).toBe('ok');
  expect(lobby.state.phase).toBe('LOBBY');
  expect(lobby.state.finalReadyIds).toEqual([]);
  expect(reduce(lobby.state, { type: 'ready_lobby', playerId: 'g', gen: fin.gen }, 7500).ack).toBe(
    'invalid',
  );

  const forced = reduce(fin, { type: 'play_again', playerId: 'h', force: true }, 7600);
  expect(forced.ack).toBe('ok');
  expect(forced.state.phase).toBe('LOBBY');

  // Nobody waits for a guest who has dropped off.
  const gone = reduce(fin, { type: 'player_disconnect', playerId: 'g' }, 7700).state;
  expect(reduce(gone, { type: 'play_again', playerId: 'h' }, 7800).ack).toBe('ok');
});

// Value: protects=marks from an earlier final screen are gone when the last round's results lead
// to a new one; fails_when=advanceFromResults stops resetting finalReadyIds; why_new=the test above
// enters FINAL through end_match only; seam=none; no_claim=none beyond protects.
test('the final screen reached from the last round starts with nobody ready', () => {
  const room = resultsRoomWithGuest();
  const last = { ...room, settings: { ...room.settings, rounds: 1 }, finalReadyIds: ['g'] };
  const fin = reduce(
    last,
    { type: 'next_round', playerId: 'h', roundNumber: 1, force: true },
    7000,
  ).state;
  expect(fin.phase).toBe('FINAL');
  expect(projectView(fin, 'h').final?.readyIds).toEqual([]);
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

test('a disconnected lobby guest expires once after ten minutes', () => {
  let state = makeRoom();
  state = reduce(
    state,
    { type: 'player_join', playerId: 'h', secret: 'h', name: 'Хост', color: 'p-1', isHost: true },
    10,
  ).state;
  state = reduce(
    state,
    { type: 'player_join', playerId: 'g', secret: 'g', name: 'Гость', color: 'p-2', isHost: false },
    20,
  ).state;
  const tenMinutesAfterDisconnect = 100 + 10 * 60_000;
  const disconnected = reduce(state, { type: 'player_disconnect', playerId: 'g' }, 100);
  expect(disconnected.effects).toContainEqual({
    type: 'schedule_guest_seat_expiry',
    playerId: 'g',
    atMs: tenMinutesAfterDisconnect,
  });
  const early = reduce(
    disconnected.state,
    { type: 'expire_disconnected_guest', playerId: 'g' },
    tenMinutesAfterDisconnect - 1,
  );
  expect(early.state.players.g).toBeDefined();
  const expired = reduce(
    early.state,
    { type: 'expire_disconnected_guest', playerId: 'g' },
    tenMinutesAfterDisconnect,
  );
  expect(expired.state.players.g).toBeUndefined();
  expect(expired.state.playerOrder).toEqual(['h']);
  expect(
    reduce(expired.state, { type: 'expire_disconnected_guest', playerId: 'g' }, 999).state,
  ).toBe(expired.state);
});

test('reconnect keeps a guest seat and cancels its pending lobby expiry', () => {
  let state = makeRoom();
  state = reduce(
    state,
    { type: 'player_join', playerId: 'g', secret: 'g', name: 'Гость', color: 'p-2', isHost: false },
    10,
  ).state;
  state = reduce(state, { type: 'player_disconnect', playerId: 'g' }, 20).state;
  const reconnected = reduce(state, { type: 'player_reconnect', playerId: 'g', isHost: false }, 30);
  expect(reconnected.state.players.g?.connected).toBe(true);
  expect(reconnected.effects).toContainEqual({ type: 'cancel_guest_seat_expiry', playerId: 'g' });
  const lateExpiry = reduce(
    reconnected.state,
    { type: 'expire_disconnected_guest', playerId: 'g' },
    20 + DISCONNECTED_GUEST_GRACE_MS,
  );
  expect(lateExpiry.state.players.g).toBeDefined();
});

test('only the host can free an offline guest seat in the lobby', () => {
  let state = makeRoom();
  state = reduce(
    state,
    { type: 'player_join', playerId: 'h', secret: 'h', name: 'Хост', color: 'p-1', isHost: true },
    10,
  ).state;
  state = reduce(
    state,
    { type: 'player_join', playerId: 'g', secret: 'g', name: 'Гость', color: 'p-2', isHost: false },
    20,
  ).state;
  state = reduce(state, { type: 'player_disconnect', playerId: 'g' }, 30).state;
  expect(
    reduce(state, { type: 'release_guest_seat', playerId: 'g', targetPlayerId: 'g' }, 40).ack,
  ).toBe('forbidden');
  const released = reduce(
    state,
    { type: 'release_guest_seat', playerId: 'h', targetPlayerId: 'g' },
    40,
  );
  expect(released.ack).toBe('ok');
  expect(released.state.players.g).toBeUndefined();
  expect(released.effects).toContainEqual({ type: 'cancel_guest_seat_expiry', playerId: 'g' });
});

test('returning to the lobby preserves match seats only until their grace expires', () => {
  let state = makeRoom({ phase: 'FINAL' });
  state = reduce(
    state,
    { type: 'player_join', playerId: 'h', secret: 'h', name: 'Хост', color: 'p-1', isHost: true },
    10,
  ).state;
  state = reduce(
    state,
    { type: 'player_join', playerId: 'g', secret: 'g', name: 'Гость', color: 'p-2', isHost: false },
    20,
  ).state;
  state = reduce(state, { type: 'player_disconnect', playerId: 'g' }, 30).state;
  const lobby = reduce(state, { type: 'play_again', playerId: 'h' }, 40);
  expect(lobby.state.players.g?.totalScore).toBe(0);
  expect(lobby.effects).toContainEqual({
    type: 'schedule_guest_seat_expiry',
    playerId: 'g',
    atMs: 30 + DISCONNECTED_GUEST_GRACE_MS,
  });
  const expiredLobby = reduce(
    lobby.state,
    { type: 'expire_disconnected_guest', playerId: 'g' },
    30 + DISCONNECTED_GUEST_GRACE_MS,
  );
  expect(expiredLobby.state.players.g).toBeUndefined();
});
