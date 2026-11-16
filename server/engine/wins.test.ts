import { expect, test } from 'bun:test';
import type { MatchRecord } from '../../shared/storage-schemas.ts';
import { computeWins6h, createWinsClock, WIN_WINDOW_MS } from './wins.ts';
import { handleProfileAction } from './profile.ts';
import type { RoomState } from './types.ts';

const now = Date.parse('2026-01-01T12:00:00Z');
function record(
  endedAt: number,
  participants: MatchRecord['participants'],
  playedRounds = 2,
): MatchRecord {
  return {
    endedAt: new Date(endedAt).toISOString(),
    playedRounds,
    plannedRounds: 2,
    participants,
  } as MatchRecord;
}
function person(id: string, isAi = false, rank = 1): MatchRecord['participants'][number] {
  return {
    id,
    name: id,
    isAi,
    rank,
    profileId: isAi ? undefined : id,
    color: 'p-1',
    totalScore: 1,
    answeredRounds: 1,
    totalDistanceKm: 0,
  };
}

test('wins use the inclusive window, complete matches and a unique first place', () => {
  // protects: exact six-hour window and complete unique winners; fails_when: old, future, partial or tied matches count; no_claim: persistence.
  const rows = [
    record(now - WIN_WINDOW_MS, [person('human')]),
    record(now - WIN_WINDOW_MS - 1, [person('human')]),
    record(now + 1, [person('human')]),
    record(now, [person('human')], 1),
    record(now, [person('human'), person('bot', true)]),
  ];
  expect(computeWins6h(rows, now, {}).byProfileId.human).toBe(1);
});

test('wins use stable IDs and strict bot reset without prototype collisions', () => {
  // protects: stable identity and reset boundaries; fails_when: inherited keys collide or reset includes equal timestamp; no_claim: settings persistence.
  const rows = [
    record(now, [person('__proto__')]),
    record(now, [person('constructor', true)]),
    record(now - 1, [person('other', true)]),
  ];
  const wins = computeWins6h(rows, now, { constructor: new Date(now).toISOString() });
  expect(wins.byProfileId['__proto__']).toBe(1);
  expect(wins.byBotId.constructor).toBeUndefined();
  expect(wins.byBotId.other).toBe(1);
});

function room(): RoomState {
  return {
    phase: 'LOBBY',
    players: {
      h: { id: 'h', name: 'Host', color: 'p-1', isHost: true },
      g: { id: 'g', name: 'Guest', color: 'p-2', isHost: false },
    },
    settings: { bots: [{ id: 'bot', name: 'Bot', color: 'p-3', enabled: false }] },
  } as unknown as RoomState;
}

test('profile edits allow duplicate human and bot display values and preserve phase rules', () => {
  // U6 protects: duplicate presentation values and phase/input rules; fails_when: occupied values block edits or invalid phase/input succeeds; no_claim: isolated functions; not browser, tunnel or hosted model.
  const state = room();
  expect(
    handleProfileAction(
      state,
      { type: 'update_profile', playerId: 'g', nick: 'guest', color: 'p-2' },
      now,
    ).ack,
  ).toBe('ok');
  expect(
    handleProfileAction(
      state,
      { type: 'update_profile', playerId: 'g', nick: 'bot', color: 'p-4' },
      now,
    ).ack,
  ).toBe('ok');
  expect(
    handleProfileAction(
      state,
      { type: 'update_profile', playerId: 'g', nick: 'New', color: 'p-3' },
      now,
    ).ack,
  ).toBe('ok');
  expect(
    handleProfileAction(
      state,
      { type: 'update_profile', playerId: 'g', nick: 'Valid', color: 'invalid' as 'p-1' },
      now,
    ).ack,
  ).toBe('invalid');
  for (const nick of ['', ' '.repeat(2), 'x'.repeat(21)]) {
    expect(
      handleProfileAction(state, { type: 'update_profile', playerId: 'g', nick, color: 'p-1' }, now)
        .ack,
    ).toBe('invalid');
  }
  expect(
    handleProfileAction(
      { ...state, phase: 'FINAL' },
      { type: 'update_profile', playerId: 'g', nick: 'New', color: 'p-4' },
      now,
    ).state.players.g?.name,
  ).toBe('New');
  expect(
    handleProfileAction(
      { ...state, phase: 'ROUND_ACTIVE' },
      { type: 'update_profile', playerId: 'g', nick: 'New', color: 'p-4' },
      now,
    ).ack,
  ).toBe('invalid');
});

test('bot reset is host-only and persists a timestamp', () => {
  // protects: reset authorization and deferred persistence; fails_when: guest or active match resets or pending reset is visible; no_claim: disk write success.
  const state = room();
  expect(
    handleProfileAction(state, { type: 'reset_bot_wins', playerId: 'g', botId: 'bot' }, now).ack,
  ).toBe('forbidden');
  expect(
    handleProfileAction(
      { ...state, phase: 'ROUND_ACTIVE' },
      { type: 'reset_bot_wins', playerId: 'h', botId: 'bot' },
      now,
    ).ack,
  ).toBe('invalid');
  const out = handleProfileAction(
    state,
    { type: 'reset_bot_wins', playerId: 'h', botId: 'bot' },
    now,
  );
  expect(out.state.settings.bots[0]?.winResetAt).toBeUndefined();
  expect(out.effects[0]?.type).toBe('persist_bot_wins_reset');
});

test('shell restores historical wins, broadcasts expiry and disposes its timer', async () => {
  // protects: startup history and idle expiration; fails_when: stale counts persist without user events; no_claim: filesystem parsing or timer accuracy under load.
  const { createRoomShell } = await import('./shell.ts');
  const initial = room();
  initial.wins6h = { byProfileId: {}, byBotId: {} };
  let clock = now;
  const history = [record(clock - WIN_WINDOW_MS, [person('public')])];
  let broadcasts = 0;
  let expired!: () => void;
  const expiration = new Promise<void>((resolve) => {
    expired = resolve;
  });
  const shell = createRoomShell(initial, {
    now: () => clock,
    matchRecords: history,
    onStateChange: () => {
      broadcasts += 1;
      expired();
    },
    saveSettings: async () => {},
    confirmQuotaReset: () => Promise.resolve(initial.quotaSummary),
    prepareRound: () => Promise.reject(new Error('unused')),
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
    expect(shell.getState().wins6h.byProfileId.public).toBe(1);
    clock += 1;
    await expiration;
    expect(shell.getState().wins6h.byProfileId.public).toBeUndefined();
    expect(broadcasts).toBe(1);
  } finally {
    shell.dispose();
  }
});

test('settings reset waits for persistence, preserves concurrent edits and warns on failure', async () => {
  // protects: durable reset, concurrent lobby changes and visible failure; fails_when: pending/failed writes clear wins or stale snapshots replace edits; no_claim: real filesystem durability.
  const { createRoomShell } = await import('./shell.ts');
  for (const succeeds of [true, false]) {
    const initial = room();
    initial.playerOrder = ['h', 'g'];
    initial.wins6h = { byProfileId: {}, byBotId: {} };
    let resolveSave!: () => void;
    let rejectSave!: (error: Error) => void;
    let started!: () => void;
    let completed!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const completedPromise = new Promise<void>((resolve) => {
      completed = resolve;
    });
    const pending = new Promise<void>((resolve, reject) => {
      resolveSave = resolve;
      rejectSave = reject;
    });
    const saved: RoomState['settings'][] = [];
    let savedDone!: () => void;
    const savedPromise = new Promise<void>((resolve) => {
      savedDone = resolve;
    });
    const shell = createRoomShell(initial, {
      now: () => now,
      matchRecords: [record(now - 1, [person('bot', true)])],
      onStateChange: (state) => {
        if (state.winsWarning || state.settings.bots[0]?.winResetAt) completed();
      },
      saveSettings: (settings) => {
        saved.push(settings);
        savedDone();
        return Promise.resolve();
      },
      saveSettingsForReset: () => {
        started();
        return pending;
      },
      confirmQuotaReset: () => Promise.resolve(initial.quotaSummary),
      prepareRound: () => Promise.reject(new Error('unused')),
      startBotProcesses: () => {},
      releaseBotObserve: () => {},
      stopBotProcess: () => {},
      stopAllBots: () => {},
      clearRoundImages: () => {},
      clearThumbs: () => {},
      appendMatchRecord: () => Promise.resolve(),
      logRoundEnd: () => {},
    });
    try {
      expect(shell.dispatch({ type: 'reset_bot_wins', playerId: 'h', botId: 'bot' })).toBe('ok');
      await startedPromise;
      expect(shell.getState().wins6h.byBotId.bot).toBe(1);
      shell.dispatch({ type: 'update_lobby', playerId: 'h', patch: { rounds: 5 } });
      if (succeeds) resolveSave();
      else rejectSave(new Error('write failed'));
      await completedPromise;
      expect(shell.getState().settings.rounds).toBe(5);
      expect(shell.getState().wins6h.byBotId.bot).toBe(succeeds ? undefined : 1);
      expect(Boolean(shell.getState().winsWarning)).toBe(!succeeds);
      await savedPromise;
      expect(saved.at(-1)?.bots[0]?.winResetAt).toBe(
        succeeds ? new Date(now).toISOString() : undefined,
      );
    } finally {
      shell.dispose();
    }
  }
});

test('wins cache prunes expired, invalid and irrelevant records and keeps future boundaries', () => {
  // protects: bounded history and future scheduling; fails_when: stale or invalid records remain or future wins disappear; no_claim: disk retention.
  const records = [
    record(now - WIN_WINDOW_MS - 1, [person('old')]),
    { ...record(now, [person('bad')]), endedAt: 'invalid' },
    record(now, [person('tie'), person('other')]),
    record(now + 1000, [person('future')]),
    record(now, [person('current')]),
  ];
  let seen = computeWins6h([], now, {});
  const clock = createWinsClock(
    records,
    () => now,
    () => ({}),
    (wins) => {
      seen = wins;
    },
  );
  try {
    clock.refresh();
    expect(records).toHaveLength(2);
    expect(seen.byProfileId.current).toBe(1);
    expect(seen.byProfileId.future).toBeUndefined();
  } finally {
    clock.dispose();
  }
});

// U7 protects: equal display values keep separate six-hour wins through renames;
// fails_when: wins combine or move between profile IDs; no_claim: isolated functions; not browser, tunnel or hosted model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('equal names and colors do not merge profile wins through renames', () => {
  const a = { ...person('profile-a'), name: 'Same', color: 'p-1' as const };
  const b = { ...person('profile-b'), name: 'Same', color: 'p-1' as const };
  const records = [
    record(now, [a]),
    record(now - 1, [b]),
    record(now - 2, [{ ...a, name: 'Renamed' }]),
    record(now - WIN_WINDOW_MS - 1, [b]),
  ];
  expect(computeWins6h(records, now, {}).byProfileId).toEqual({ 'profile-a': 2, 'profile-b': 1 });
});
