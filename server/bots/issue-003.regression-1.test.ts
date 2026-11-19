import { expect, test } from 'bun:test';
import { createDefaultSettings } from '../../shared/storage-schemas.ts';
import { buildQuotaMetric } from '../storage/quota.ts';
import { createRoomShell } from '../engine/shell.ts';
import { reduce } from '../engine/reduce.ts';
import { createInitialRoomState } from '../engine/types.ts';
import { createBotToolQueue } from './queue.ts';

// Regression: ISSUE-003
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Protects time feedback on tool calls; does not assert model compliance.
test('harness receives time on success and error', async () => {
  let remaining = 42;
  const q = createBotToolQueue({
    moveLimit: 2,
    moveEnabled: true,
    handlers: {
      waitObserveRelease: async () => {},
      executeObserve: () => Promise.resolve({ text: 'frames' }),
      executeLook: () => Promise.resolve({ text: 'look' }),
      executeMove: () => Promise.resolve({ text: 'move' }),
      onGuess: () => {},
      onTurnsChanged: () => {},
      getRemainingTimeSec: () => remaining,
    },
  });
  expect((await q.dispatch('observe', {})).text).toContain('42 с');
  remaining = 5;
  const error = await q.dispatch('look', { heading: 999 });
  expect(error.isError).toBe(true);
  expect(error.text).toContain('5 с');
  expect(error.text).toContain('final_guess');
  const look = await q.dispatch('look', { heading: 90 });
  expect(look.text).toContain('5 с');
  expect(look.text).toContain('final_guess');
});

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

// Regression: ISSUE-003
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Protects the actual shell-to-runner contract when a bot budget exceeds the round.
test('runner receives the effective round deadline budget without mutating settings', () => {
  let state = createInitialRoomState({
    matchId: 'm',
    fakeMode: true,
    settings: { ...createDefaultSettings(), roundDurationSec: 60 },
    quotaSummary: quota,
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [
      { id: 'agy', available: true, readsOwnerFiles: true, models: ['gemini-3.8-flash-low'] },
    ],
  });
  state = reduce(
    state,
    {
      type: 'player_join',
      playerId: 'host',
      secret: 's',
      name: 'Host',
      color: 'p-1',
      isHost: true,
    },
    1,
  ).state;
  state = reduce(state, { type: 'add_bot', playerId: 'host' }, 2).state;
  const bot = state.settings.bots[0];
  if (!bot) throw new Error('Expected a bot');
  bot.budgetSec = 120;
  state = reduce(state, { type: 'start_match', playerId: 'host' }, 3).state;
  let received = 0;
  const shell = createRoomShell(state, {
    saveSettings: () => {},
    confirmQuotaReset: () => Promise.resolve(quota),
    prepareRound: () => new Promise(() => {}),
    startBotProcesses: ({ bots }) => {
      received = bots[0]?.budgetSec ?? 0;
    },
    releaseBotObserve: () => {},
    stopBotProcess: () => {},
    stopAllBots: () => {},
    clearRoundImages: () => {},
    clearThumbs: () => {},
    appendMatchRecord: async () => {},
    logRoundEnd: () => {},
  });
  try {
    shell.dispatch({
      type: 'round_prepared',
      matchId: state.matchId,
      gen: state.gen,
      roundNumber: 1,
      target: {
        panoId: 'p',
        lat: 0,
        lng: 0,
        countryId: 'x',
        countryNameRu: 'x',
        region: 'world',
        fakeSceneIndex: 0,
      },
    });
    expect(received).toBe(60);
    expect(shell.getState().settings.bots[0]?.budgetSec).toBe(120);
  } finally {
    shell.dispose();
  }
});
