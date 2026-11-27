import { expect, test } from 'bun:test';
import { createDefaultSettings } from '../../shared/storage-schemas.ts';
import { buildQuotaMetric } from '../storage/quota.ts';
import { reduce } from './reduce.ts';
import { createRoomShell } from './shell.ts';
import { createInitialRoomState, type RoomState, type RoundTarget } from './types.ts';

const metric = buildQuotaMetric(0, 8000);
const quota = {
  metrics: { static: metric, pano: metric, map: metric },
  staticUsed: 0,
  staticCeiling: 8000,
  staticWorstCase: 0,
  panoUsed: 0,
  panoCeiling: 8000,
  panoWorstCase: 0,
  mapUsed: 0,
  mapCeiling: 8000,
  mapWorstCase: 0,
  needsResetConfirm: false,
  sufficient: true,
};

const TARGET: RoundTarget = {
  panoId: 'p',
  lat: 0,
  lng: 0,
  countryId: 'x',
  countryNameRu: 'x',
  map: 'standard',
  region: 'world',
  fakeSceneIndex: 0,
};

/** Two humans in an active round whose first answer leaves the other one second (a push). */
function activeRoundOfTwo(now: number): RoomState {
  let s = createInitialRoomState({
    matchId: 'm',
    fakeMode: true,
    settings: { ...createDefaultSettings(), pushEnabled: true, pushSeconds: 1 },
    quotaSummary: quota,
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [],
  });
  const join = (playerId: string, isHost: boolean, color: 'p-1' | 'p-2'): void => {
    s = reduce(
      s,
      { type: 'player_join', playerId, secret: playerId, name: playerId, color, isHost },
      now,
    ).state;
  };
  join('host', true, 'p-1');
  join('guest', false, 'p-2');
  s = reduce(s, { type: 'start_match', playerId: 'host' }, now).state;
  const round = { matchId: s.matchId, gen: s.gen };
  s = reduce(s, { type: 'round_prepared', ...round, roundNumber: 1, target: TARGET }, now).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'host', roundNumber: 1 }, now).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'guest', roundNumber: 1 }, now).state;
  return reduce(s, { type: 'countdown_done', ...round }, now).state;
}

const GRACE_MS = 100;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Value: protects=a pin that reaches the server just after the shown end of the round is still
// scored; fails_when=the round closes at the shown deadline again and the older pin is scored;
// why_new=no test ran the round deadline through the shell's real timer; seam=ShellDeps.latePinGraceMs (100 ms instead of the shared one second);
// no_claim=the browser's pin throttle and the network delay themselves.
test('a pin sent in the last second of a round still counts', async () => {
  const state = activeRoundOfTwo(Date.now());
  expect(state.phase).toBe('ROUND_ACTIVE');
  const shell = createRoomShell(state, {
    latePinGraceMs: GRACE_MS,
    saveSettings: () => undefined,
    confirmQuotaReset: () => Promise.resolve(quota),
    prepareRound: () => new Promise(() => {}),
    startBotProcesses: () => {},
    releaseBotObserve: () => {},
    stopBotProcess: () => {},
    stopAllBots: () => {},
    clearRoundImages: () => {},
    clearThumbs: () => {},
    appendMatchRecord: async () => {},
    logRoundEnd: () => {},
  });
  try {
    const early = { type: 'set_pin', playerId: 'guest', roundNumber: 1 } as const;
    expect(shell.dispatch({ ...early, lat: 50, lng: 50 })).toBe('ok');
    // The host answers: the push leaves the guest one second.
    expect(
      shell.dispatch({ type: 'submit_guess', playerId: 'host', roundNumber: 1, lat: 1, lng: 1 }),
    ).toBe('ok');
    const shownEnd = shell.getState().loadingOrActive?.endsAt ?? 0;
    await sleep(shownEnd - Date.now() + GRACE_MS / 2);
    // The timer on the players' screens has run out, the last pin is still on its way.
    expect(Date.now()).toBeGreaterThan(shownEnd);
    expect(shell.dispatch({ ...early, lat: 10, lng: 20 })).toBe('ok');
    await sleep(GRACE_MS);
    expect(shell.getState().phase).toBe('ROUND_RESULTS');
    const entry = shell.getView('guest').results?.entries.find((e) => e.id === 'guest');
    expect(entry?.lat).toBe(10);
    expect(entry?.lng).toBe(20);
    expect(shell.dispatch({ ...early, lat: 30, lng: 30 })).toBe('round_over');
  } finally {
    shell.dispose();
  }
});
