import { buildQuotaMetric } from '../storage/quota.ts';
import { expect, test } from 'bun:test';
import type { QuotaSummaryView } from '../../shared/protocol.ts';
import { reduce } from './reduce.ts';
import { createRoomShell } from './shell.ts';
import { createInitialRoomState, type RoomState } from './types.ts';

function makeSummary(overrides: Partial<QuotaSummaryView> = {}): QuotaSummaryView {
  return {
    metrics: {
      static: buildQuotaMetric(0, 8000),
      pano: buildQuotaMetric(0, 4000),
      map: buildQuotaMetric(0, 8000),
    },
    staticUsed: 0,
    staticCeiling: 8000,
    staticWorstCase: 0,
    panoUsed: 0,
    panoCeiling: 4000,
    panoWorstCase: 4,
    mapUsed: 0,
    mapCeiling: 8000,
    mapWorstCase: 4,
    needsResetConfirm: false,
    sufficient: true,
    ...overrides,
  };
}

function makeLobby(quotaSummary: QuotaSummaryView): RoomState {
  const base = createInitialRoomState({
    matchId: 'm-quota',
    fakeMode: true,
    settings: {
      version: 1,
      region: 'world',
      rounds: 2,
      roundDurationSec: 60,
      moveEnabled: true,
      aiWaitWindowSec: 30,
      showMatchStandings: true,
      pushEnabled: false,
      pushSeconds: 15,
      allowBotPush: true,
      bots: [],
    },
    quotaSummary,
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [],
  });
  return reduce(
    base,
    { type: 'player_join', playerId: 'h', secret: 's', name: 'Хост', color: 'p-1', isHost: true },
    1,
  ).state;
}

test('confirm_quota_reset keeps the start gate closed until the reset is persisted', () => {
  const s = makeLobby(makeSummary({ needsResetConfirm: true }));
  const out = reduce(s, { type: 'confirm_quota_reset', playerId: 'h' }, 2);
  expect(out.ack).toBe('ok');
  expect(out.effects).toEqual([{ type: 'confirm_quota_reset' }]);
  expect(out.state.quotaSummary.needsResetConfirm).toBe(true);
  expect(reduce(out.state, { type: 'start_match', playerId: 'h' }, 3).ack).toBe('invalid');
});

test('start_match re-reads live quota instead of the cached lobby summary', () => {
  let live = makeSummary();
  const shell = createRoomShell(makeLobby(makeSummary()), {
    saveSettings: () => {},
    confirmQuotaReset: () => Promise.resolve(live),
    recalculateQuotaSummary: () => live,
    prepareRound: () => new Promise(() => undefined),
    startBotProcesses: () => undefined,
    releaseBotObserve: () => undefined,
    stopBotProcess: () => undefined,
    stopAllBots: () => undefined,
    clearRoundImages: () => undefined,
    clearThumbs: () => undefined,
    appendMatchRecord: () => Promise.resolve(),
    logRoundEnd: () => undefined,
  });
  // Quota got exhausted (e.g. by pano loads) after the last lobby edit.
  live = makeSummary({ sufficient: false, exceedsMessage: 'Панорамы: 4000 + 4 > 4000' });
  expect(shell.dispatch({ type: 'start_match', playerId: 'h' })).toBe('invalid');
  expect(shell.getState().phase).toBe('LOBBY');
  live = makeSummary();
  expect(shell.dispatch({ type: 'start_match', playerId: 'h' })).toBe('ok');
  shell.dispose();
});
