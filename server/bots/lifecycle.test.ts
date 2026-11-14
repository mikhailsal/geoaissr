import { expect, test } from 'bun:test';
import { handleAddBot, handleUpdateBot } from '../engine/lobby.ts';
import { reduce } from '../engine/reduce.ts';
import { createInitialRoomState } from '../engine/types.ts';
import { createFakeLocationService } from '../location.ts';
import { createMoveTracker } from './move.ts';
import { createBotToolQueue } from './queue.ts';

test('queue aborts pending observe cleanly without calling executeObserve after abort', async () => {
  let observeCalls = 0;
  const waiter: { release: () => void } = {
    release: () => undefined,
  };
  const q = createBotToolQueue({
    moveLimit: 0,
    moveEnabled: false,
    handlers: {
      waitObserveRelease: () =>
        new Promise<void>((res) => {
          waiter.release = res;
        }),
      executeObserve: () => {
        observeCalls += 1;
        return Promise.resolve({ text: 'ok' });
      },
      executeLook: () => Promise.resolve({ text: 'ok' }),
      executeMove: () => Promise.resolve({ text: 'ok' }),
      onGuess: () => undefined,
      onTurnsChanged: () => undefined,
      getRemainingTimeSec: () => 30,
    },
  });

  const pending = q.dispatch('observe', {});
  q.abort('test_abort');
  waiter.release();
  const res = await pending;
  expect(res.isError).toBe(true);
  expect(observeCalls).toBe(0);
});

test('MoveTracker restorePosition rolls back coordinates cleanly on failure', async () => {
  const tracker = createMoveTracker({
    initial: {
      panoId: 'p0',
      lat: 55.75,
      lng: 37.61,
      fakeSceneIndex: 0,
    },
    moveEnabled: true,
    fakeMode: true,
    locationService: createFakeLocationService(),
  });
  const before = tracker.getPosition();
  await tracker.stepToward(90);
  expect(tracker.getPosition().steps).toBe(1);
  tracker.restorePosition(before);
  expect(tracker.getPosition()).toEqual(before);
});

test('lobby bot IDs avoid collisions and unavailable harness keeps enabled false', () => {
  const base = createInitialRoomState({
    matchId: 'm-bot',
    fakeMode: true,
    settings: {
      version: 1,
      region: 'world',
      rounds: 2,
      roundDurationSec: 60,
      moveEnabled: true,
      aiWaitWindowSec: 30,
      bots: [],
    },
    quotaSummary: {
      staticUsed: 0,
      staticCeiling: 8000,
      staticWorstCase: 0,
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
    availableHarnesses: [
      { id: 'claude', available: true, readsOwnerFiles: false, models: ['haiku'] },
      {
        id: 'agy',
        available: false,
        reason: 'not installed',
        readsOwnerFiles: true,
        models: ['m'],
      },
    ],
  });
  const s1 = {
    ...base,
    players: {
      h: {
        id: 'h',
        secret: 's',
        name: 'H',
        color: 'p-1' as const,
        isHost: true,
        connected: true,
        isSpectator: false,
        panoLoaded: false,
        totalScore: 0,
        answeredRounds: 0,
        totalDistanceKm: 0,
      },
    },
    playerOrder: ['h'],
  };
  const a1 = handleAddBot(s1, 'h').state;
  const a2 = handleAddBot(a1, 'h').state;
  const ids = a2.settings.bots.map((b) => b.id);
  expect(new Set(ids).size).toBe(2);

  const firstId = a2.settings.bots[0]?.id ?? '';
  const disabledRes = handleUpdateBot(a2, 'h', firstId, { harness: 'agy', enabled: true }).state;
  expect(disabledRes.settings.bots[0]?.enabled).toBe(false);
  const stillDisabled = handleUpdateBot(disabledRes, 'h', firstId, { enabled: true }).state;
  expect(stillDisabled.settings.bots[0]?.enabled).toBe(false);
});

function makeEarlyFailState(matchId = 'm-early') {
  return createInitialRoomState({
    matchId,
    fakeMode: true,
    settings: {
      version: 1,
      region: 'world',
      rounds: 1,
      roundDurationSec: 60,
      moveEnabled: false,
      aiWaitWindowSec: 30,
      bots: [
        {
          id: 'b1',
          name: 'Bot1',
          color: 'p-3',
          enabled: true,
          harness: 'claude',
          model: 'haiku',
          effort: 'low',
          moveLimit: 0,
          imageSize: 400,
          budgetSec: 60,
          personalityPreset: 'neutral',
          personalityText: '',
          difficultyPreset: 'amateur',
        },
      ],
    },
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
    availableHarnesses: [
      { id: 'claude', available: true, readsOwnerFiles: false, models: ['haiku'] },
    ],
  });
}

test('bot_finished during ROUND_LOADING preserves failure diagnostics until countdown_done', () => {
  let s = reduce(
    makeEarlyFailState(),
    { type: 'player_join', playerId: 'h', secret: 's', name: 'H', color: 'p-1', isHost: true },
    1000,
  ).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1001).state;
  s = reduce(
    s,
    {
      type: 'round_prepared',
      matchId: 'm-early',
      gen: s.gen,
      roundNumber: 1,
      target: {
        panoId: 'p1',
        lat: 50,
        lng: 10,
        countryId: 'X',
        countryNameRu: 'X',
        region: 'world',
        fakeSceneIndex: 0,
      },
    },
    1002,
  ).state;
  s = reduce(
    s,
    {
      type: 'bot_finished',
      matchId: 'm-early',
      gen: s.gen,
      roundNumber: 1,
      botId: 'b1',
      aborted: true,
      reason: 'CLI crashed',
      diagnosticsTail: 'stderr boom',
    },
    1005,
  ).state;
  expect(s.loadingOrActive?.bots.b1?.status).toBe('aborted');
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1010).state;
  s = reduce(s, { type: 'countdown_done', matchId: 'm-early', gen: s.gen }, 4020).state;
  expect(s.phase).toBe('ROUND_ACTIVE');
  expect(s.loadingOrActive?.bots.b1?.status).toBe('aborted');
  expect(s.loadingOrActive?.bots.b1?.abortReason).toBe('CLI crashed');
  expect(s.loadingOrActive?.bots.b1?.diagnosticsTail).toBe('stderr boom');
  s = reduce(
    s,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 50, lng: 10 },
    4030,
  ).state;
  expect(s.phase).toBe('ROUND_RESULTS');
});

test('bot turns, thumbs, and guesses recorded during ROUND_LOADING are preserved into ROUND_ACTIVE', () => {
  let s = makeEarlyFailState('m-load-prog');
  s = reduce(
    s,
    { type: 'player_join', playerId: 'h', secret: 's1', name: 'Host', color: 'p-1', isHost: true },
    100,
  ).state;
  const botId = s.settings.bots[0]?.id ?? 'b1';
  expect(handleAddBot(s, 'h').state.settings.bots.length).toBe(2);
  expect(handleUpdateBot(s, 'h', botId, { enabled: true }).state.settings.bots[0]?.enabled).toBe(
    true,
  );
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    {
      type: 'round_prepared',
      matchId: 'm-load-prog',
      gen: s.gen,
      roundNumber: 1,
      target: {
        panoId: 'p1',
        lat: 48.8,
        lng: 2.3,
        countryId: 'FR',
        countryNameRu: 'Франция',
        region: 'europe',
        fakeSceneIndex: 0,
      },
    },
    1002,
  ).state;
  s = reduce(
    s,
    {
      type: 'bot_turns_updated',
      matchId: 'm-load-prog',
      gen: s.gen,
      roundNumber: 1,
      botId,
      turnsUsed: 1,
    },
    1005,
  ).state;
  s = reduce(
    s,
    {
      type: 'bot_thumb_added',
      matchId: 'm-load-prog',
      gen: s.gen,
      roundNumber: 1,
      botId,
      thumb: { turn: 0, action: 'observe', label: 'N', thumbUrl: '/thumb/t1' },
    },
    1006,
  ).state;
  s = reduce(
    s,
    {
      type: 'bot_guess_recorded',
      matchId: 'm-load-prog',
      gen: s.gen,
      roundNumber: 1,
      botId,
      guess: { lat: 48.8, lng: 2.3, explanation: 'Eiffel' },
    },
    1007,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1010).state;
  s = reduce(s, { type: 'countdown_done', matchId: 'm-load-prog', gen: s.gen }, 4020).state;
  const activeBot = s.loadingOrActive?.bots[botId];
  expect(activeBot?.turnsUsed).toBe(1);
  expect(activeBot?.thumbs.length).toBe(1);
  expect(activeBot?.guess?.lat).toBe(48.8);
});
