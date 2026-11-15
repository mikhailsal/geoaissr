import { buildQuotaMetric } from '../storage/quota.ts';
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

  const guestView = projectView(s, 'g');
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

  const view = projectView(s, 'h');
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

  const resView = projectView(s, 'h');
  expect(resView.results?.countryNameRu).toBe('Франция');
  expect(resView.results?.entries.find((e) => e.isAi)?.roundScore).toBe(5000);

  s = reduce(s, { type: 'next_round', playerId: 'h', roundNumber: 1 }, 6000).state;
  const finalView = projectView(s, 'h');
  expect(finalView.phase).toBe('FINAL');
  expect(finalView.final?.standings[0]?.isAi).toBe(true);
  expect(finalView.final?.standings[0]?.perRound[0]?.botCard?.explanation).toBe('Эйфелева башня');
});

const BOT_ABORT_REASON = 'ошибка процесса (код 1)';
const BOT_STDERR = 'claude: authentication failed, run `claude login` (cwd /home/user/run/bot-1)';

/** A one-round match where the only AI aborted with raw CLI output and both humans confirmed. */
function makeResultsRoomWithFailedBot(): RoomState {
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
  const botId = s.settings.bots[0]?.id ?? '';
  s = reduce(
    s,
    {
      type: 'bot_finished',
      matchId: 'm-view',
      gen: s.gen,
      roundNumber: 1,
      botId,
      aborted: true,
      reason: BOT_ABORT_REASON,
      diagnosticsTail: BOT_STDERR,
    },
    4600,
  ).state;
  s = reduce(
    s,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 48, lng: 2 },
    5000,
  ).state;
  s = reduce(
    s,
    { type: 'submit_guess', playerId: 'g', roundNumber: 1, lat: 47, lng: 3 },
    5001,
  ).state;
  return s;
}

test('round results show raw bot diagnostics to the host only; guests keep the abort reason', () => {
  const s = makeResultsRoomWithFailedBot();
  expect(s.phase).toBe('ROUND_RESULTS');

  const hostEntry = projectView(s, 'h').results?.entries.find((e) => e.isAi);
  expect(hostEntry?.terminationReason).toBe(BOT_ABORT_REASON);
  expect(hostEntry?.diagnosticsTail).toBe(BOT_STDERR);

  const guestView = projectView(s, 'g');
  const guestEntry = guestView.results?.entries.find((e) => e.isAi);
  expect(guestEntry?.terminationReason).toBe(BOT_ABORT_REASON);
  expect(guestEntry?.diagnosticsTail).toBeUndefined();
  expect(JSON.stringify(guestView)).not.toContain('claude login');
});

test('final screen bot cards show raw bot diagnostics to the host only', () => {
  const resultsRoom = makeResultsRoomWithFailedBot();
  const s = reduce(resultsRoom, { type: 'next_round', playerId: 'h', roundNumber: 1 }, 6000).state;
  expect(s.phase).toBe('FINAL');

  const cardFor = (viewerId: string) =>
    projectView(s, viewerId).final?.standings.find((row) => row.isAi)?.perRound[0]?.botCard;
  expect(cardFor('h')?.diagnosticsTail).toBe(BOT_STDERR);
  expect(cardFor('g')?.terminationReason).toBe(BOT_ABORT_REASON);
  expect(cardFor('g')?.diagnosticsTail).toBeUndefined();
  expect(JSON.stringify(projectView(s, 'g'))).not.toContain('claude login');
});

test('completed match records profile identity once and survives match storage', async () => {
  // protects: actual match completion persists one unique winner under its public profile; fails_when: completion duplicates or omits identity; no_claim: browser storage.
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { appendMatchRecord, readMatchRecords } = await import('../storage/matches.ts');
  const { computeWins6h } = await import('./wins.ts');
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-wins-'));
  try {
    let s = makeBaseRoom();
    s = reduce(
      s,
      {
        type: 'player_join',
        playerId: 'h',
        secret: 's',
        name: 'Host',
        color: 'p-1',
        isHost: true,
        profileId: 'stable',
      },
      100,
    ).state;
    s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
    s = reduce(
      s,
      { type: 'round_prepared', matchId: s.matchId, gen: s.gen, roundNumber: 1, target: TARGET },
      1100,
    ).state;
    s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
    s = reduce(s, { type: 'countdown_done', matchId: s.matchId, gen: s.gen }, 4200).state;
    s = reduce(
      s,
      { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 48, lng: 2 },
      5000,
    ).state;
    const done = reduce(s, { type: 'next_round', playerId: 'h', roundNumber: 1 }, 6000);
    const records = done.effects.filter((e) => e.type === 'append_match_record');
    expect(records).toHaveLength(1);
    const effect = records[0];
    if (!effect) throw new Error('missing match record');
    expect(effect.record.participants[0]?.profileId).toBe('stable');
    const file = path.join(dir, 'matches.jsonl');
    appendMatchRecord(file, effect.record);
    expect(computeWins6h(readMatchRecords(file).records, 6000, {}).byProfileId.stable).toBe(1);
    expect(
      reduce(
        done.state,
        { type: 'next_round', playerId: 'h', roundNumber: 1 },
        6001,
      ).effects.filter((e) => e.type === 'append_match_record'),
    ).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completed match wins wait for persistence and failures leave counts unchanged', async () => {
  // protects: a real completed match counts only after append succeeds and failed writes report errors; fails_when: pending or rejected writes increment wins; no_claim: filesystem durability.
  const { createRoomShell } = await import('./shell.ts');
  let s = makeBaseRoom();
  s = reduce(
    s,
    {
      type: 'player_join',
      playerId: 'h',
      secret: 's',
      name: 'Host',
      color: 'p-1',
      isHost: true,
      profileId: 'stable',
    },
    100,
  ).state;
  s = reduce(s, { type: 'start_match', playerId: 'h' }, 1000).state;
  s = reduce(
    s,
    { type: 'round_prepared', matchId: s.matchId, gen: s.gen, roundNumber: 1, target: TARGET },
    1100,
  ).state;
  s = reduce(s, { type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200).state;
  s = reduce(s, { type: 'countdown_done', matchId: s.matchId, gen: s.gen }, 4200).state;
  s = reduce(
    s,
    { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 48, lng: 2 },
    5000,
  ).state;
  expect(s.phase).toBe('ROUND_RESULTS');
  for (const success of [true, false]) {
    let resolveWrite!: () => void;
    let rejectWrite!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => {
      resolveWrite = resolve;
      rejectWrite = reject;
    });
    let resultReady!: () => void;
    const result = new Promise<void>((resolve) => {
      resultReady = resolve;
    });
    let appends = 0;
    const shell = createRoomShell(s, {
      now: () => 6000,
      onStateChange: (state) => {
        if (state.matchWriteError || state.wins6h.byProfileId.stable) resultReady();
      },
      saveSettings: () => Promise.resolve(),
      confirmQuotaReset: () => Promise.resolve(s.quotaSummary),
      prepareRound: () => Promise.reject(new Error('unused')),
      startBotProcesses: () => {},
      releaseBotObserve: () => {},
      stopBotProcess: () => {},
      stopAllBots: () => {},
      clearRoundImages: () => {},
      clearThumbs: () => {},
      appendMatchRecord: () => {
        appends += 1;
        return pending;
      },
      logRoundEnd: () => {},
    });
    try {
      expect(shell.dispatch({ type: 'next_round', playerId: 'h', roundNumber: 1 })).toBe('ok');
      expect(appends).toBe(1);
      expect(shell.getState().wins6h.byProfileId.stable).toBeUndefined();
      if (success) resolveWrite();
      else rejectWrite(new Error('disk failure'));
      await result;
      expect(shell.getState().wins6h.byProfileId.stable).toBe(success ? 1 : undefined);
      expect(shell.getState().matchWriteError).toBe(success ? undefined : 'disk failure');
    } finally {
      shell.dispose();
    }
  }
});
