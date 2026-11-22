import { expect, test } from 'bun:test';
import { createDefaultSettings } from '../../shared/storage-schemas.ts';
import type { BotAccounting } from '../../shared/bot-results.ts';
import type { QuotaSummaryView } from '../../shared/protocol.ts';
import { buildQuotaMetric } from '../storage/quota.ts';
import { reduce } from './reduce.ts';
import { createInitialRoomState, type BotGuessData, type RoomState } from './types.ts';
import { projectView } from './view.ts';

const TARGET = {
  panoId: 'transparency-pano',
  lat: 48.85,
  lng: 2.35,
  countryId: '250',
  countryNameRu: 'Франция',
  region: 'world' as const,
  fakeSceneIndex: 0,
};
const USAGE = { inputTokens: 440, outputTokens: 20, cachedInputTokens: 70, totalTokens: 460 };

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value is absent');
  return value;
}

function quota(): QuotaSummaryView {
  return {
    metrics: {
      static: buildQuotaMetric(0, 8000),
      pano: buildQuotaMetric(0, 4000),
      map: buildQuotaMetric(0, 8000),
    },
    staticUsed: 0,
    staticCeiling: 8000,
    staticWorstCase: 20,
    panoUsed: 0,
    panoCeiling: 4000,
    panoWorstCase: 4,
    mapUsed: 0,
    mapCeiling: 8000,
    mapWorstCase: 4,
    needsResetConfirm: false,
    sufficient: true,
  };
}

function activeRoom(): RoomState {
  let state = createInitialRoomState({
    matchId: 'transparency-match',
    fakeMode: true,
    settings: { ...createDefaultSettings(), rounds: 2 },
    quotaSummary: quota(),
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [
      { id: 'claude', available: true, readsOwnerFiles: false, models: ['haiku'] },
    ],
  });
  state = reduce(
    state,
    {
      type: 'player_join',
      playerId: 'host',
      secret: 'h',
      name: 'Хост',
      color: 'p-1',
      isHost: true,
    },
    100,
  ).state;
  state = reduce(
    state,
    {
      type: 'player_join',
      playerId: 'guest',
      secret: 'g',
      name: 'Гость',
      color: 'p-2',
      isHost: false,
    },
    101,
  ).state;
  state = reduce(state, { type: 'add_bot', playerId: 'host' }, 102).state;
  state = reduce(state, { type: 'start_match', playerId: 'host' }, 1000).state;
  state = reduce(
    state,
    {
      type: 'round_prepared',
      matchId: state.matchId,
      gen: state.gen,
      roundNumber: 1,
      target: TARGET,
    },
    1100,
  ).state;
  state = reduce(state, { type: 'pano_loaded', playerId: 'host', roundNumber: 1 }, 1200).state;
  state = reduce(state, { type: 'pano_loaded', playerId: 'guest', roundNumber: 1 }, 1201).state;
  return reduce(state, { type: 'countdown_done', matchId: state.matchId, gen: state.gen }, 4201)
    .state;
}

function botId(state: RoomState): string {
  return present(state.settings.bots[0]).id;
}

function guess(state: RoomState, value: BotGuessData, finalized = false): RoomState {
  return reduce(
    state,
    {
      type: 'bot_guess_recorded',
      matchId: state.matchId,
      gen: state.gen,
      roundNumber: state.roundNumber,
      botId: botId(state),
      guess: value,
      finalized,
    },
    5000,
  ).state;
}

function finish(state: RoomState): RoomState {
  return reduce(
    state,
    { type: 'deadline_tick', matchId: state.matchId, gen: state.gen, kind: 'round' },
    150_000,
  ).state;
}

function accounting(
  state: RoomState,
  fields: BotAccounting,
  gen = state.gen,
  roundNumber = state.roundNumber,
): RoomState {
  return reduce(state, {
    type: 'bot_accounting',
    matchId: state.matchId,
    gen,
    roundNumber,
    botId: botId(state),
    accounting: fields,
  }).state;
}

function botResult(state: RoomState) {
  return present(present(state.results).entries.find((entry) => entry.isAi));
}

// protects=latest draft survives a full paid-step budget and scores at the deadline; fails_when=draft ends thinking or an older checkpoint is scored; no_claim=does not exercise CLI generation of a draft
test('draft checkpoints remain active and the latest draft is scored on timeout', () => {
  let state = activeRoom();
  state = guess(state, { lat: 0, lng: 0, explanation: 'early' });
  const latest = {
    lat: TARGET.lat,
    lng: TARGET.lng,
    explanation: '',
    summary: 'Париж',
  };
  state = guess(state, latest);
  state = reduce(state, {
    type: 'bot_turns_updated',
    matchId: state.matchId,
    gen: state.gen,
    roundNumber: 1,
    botId: botId(state),
    turnsUsed: present(state.settings.bots[0]).moveLimit,
  }).state;
  expect(state.phase).toBe('ROUND_ACTIVE');
  expect(present(present(state.loadingOrActive).bots[botId(state)]).status).toBe('thinking');
  const entry = botResult(finish(state));
  expect(entry.roundScore).toBe(5000);
  expect(entry.usedDraft).toBe(true);
  expect(entry.journal?.summary).toBe('Париж');
});

// protects=final overrides a draft and cannot be overwritten while terminal process accounting drains; fails_when=later draft/final changes the submitted coordinates; no_claim=does not prove process exit timing
test('final guesses take precedence and freeze subsequent submissions', () => {
  let state = guess(activeRoom(), { lat: 0, lng: 0, explanation: 'draft' });
  state = guess(
    state,
    { lat: TARGET.lat, lng: TARGET.lng, explanation: '', summary: 'Final' },
    true,
  );
  const late = guess(state, { lat: -30, lng: -70, explanation: 'late' });
  expect(late).toBe(state);
  expect(guess(state, { lat: -30, lng: -70, explanation: 'late final' }, true)).toBe(state);
  expect(present(present(state.loadingOrActive).bots[botId(state)]).status).toBe('thinking');
  expect(botResult(finish(state))).toMatchObject({
    lat: TARGET.lat,
    roundScore: 5000,
    usedDraft: false,
    journal: { summary: 'Final' },
  });
});

// protects=clean/error exits and bot-budget expiry preserve draft fallback and no-guess still scores zero; fails_when=abort discards the checkpoint or invents a guess; no_claim=does not launch an actual CLI
test('exit and bot-budget paths preserve a draft without inventing one', () => {
  for (const ending of ['exit', 'error', 'budget'] as const) {
    let state = guess(activeRoom(), {
      lat: TARGET.lat,
      lng: TARGET.lng,
      explanation: 'checkpoint',
    });
    const identity = { matchId: state.matchId, gen: state.gen, botId: botId(state) };
    state =
      ending === 'budget'
        ? reduce(state, { type: 'deadline_tick', ...identity, kind: 'bot_budget' }, 65_000).state
        : reduce(
            state,
            {
              type: 'bot_finished',
              ...identity,
              roundNumber: 1,
              aborted: ending === 'error',
              reason: ending,
            },
            6000,
          ).state;
    expect(botResult(finish(state))).toMatchObject({
      lat: TARGET.lat,
      usedDraft: true,
      roundScore: 5000,
    });
  }
  expect(botResult(finish(activeRoom()))).toMatchObject({
    lat: null,
    lng: null,
    roundScore: 0,
    usedDraft: false,
  });
});

// protects=reasoning/accounting stay private during play and are projected to host and guest after scoring; fails_when=active views leak clues or result views omit metrics; no_claim=does not test WebSocket serialization
test('structured reasoning and usage are visible only after the round', () => {
  let state = guess(activeRoom(), {
    lat: TARGET.lat,
    lng: TARGET.lng,
    explanation: '',
    summary: 'unreleased-reasoning',
  });
  state = accounting(state, { tokenUsage: USAGE, costUsd: null });
  for (const id of ['host', 'guest']) {
    const active = JSON.stringify(projectView(state, id));
    expect(active).not.toContain('unreleased-reasoning');
    expect(active).not.toContain('inputTokens');
  }
  const results = finish(state);
  for (const id of ['host', 'guest']) {
    const entry = present(present(projectView(results, id).results).entries.find((e) => e.isAi));
    expect(entry).toMatchObject({
      journal: { summary: 'unreleased-reasoning' },
      tokenUsage: USAGE,
      costUsd: null,
      usedDraft: true,
    });
  }
});

// protects=late pricing enriches its immutable result/archive after generation advances, and remains available in Final; fails_when=round completion drops prices or a later round is overwritten; no_claim=does not fetch OpenRouter
test('late accounting updates its archived round across results and the next round', () => {
  const active = accounting(
    guess(activeRoom(), { lat: TARGET.lat, lng: TARGET.lng, explanation: 'answer' }, true),
    { tokenUsage: USAGE, costUsd: null },
  );
  const original = finish(active);
  const priced = accounting(
    original,
    { costUsd: 0.004, matchedModelId: 'anthropic/claude-haiku', isApproximateMatch: true },
    active.gen,
    1,
  );
  expect(botResult(original).costUsd).toBeNull();
  expect(botResult(priced)).toMatchObject({ costUsd: 0.004, tokenUsage: USAGE, roundScore: 5000 });
  expect(present(present(priced.playedRounds[0]).entriesByParticipant[botId(priced)]).costUsd).toBe(
    0.004,
  );
  const next = reduce(
    priced,
    { type: 'next_round', playerId: 'host', roundNumber: 1 },
    151_000,
  ).state;
  const late = accounting(next, { costUsd: 0.006 }, active.gen, 1);
  expect(present(present(late.loadingOrActive).bots[botId(late)]).costUsd).toBeUndefined();
  const final = reduce(late, { type: 'end_match', playerId: 'host' }, 152_000).state;
  const standing = present(
    present(projectView(final, 'guest').final).standings.find((entry) => entry.isAi),
  );
  expect(present(present(standing.perRound[0]).botCard).costUsd).toBe(0.006);
});

// protects=accounting identities bind match, round generation and AI participant; fails_when=stale callbacks mutate newer state or human entries; no_claim=does not validate provider counter syntax
test('stale, unknown and human accounting updates are rejected', () => {
  const active = activeRoom();
  const event = {
    type: 'bot_accounting' as const,
    matchId: active.matchId,
    gen: active.gen,
    roundNumber: 1,
    botId: botId(active),
    accounting: { tokenUsage: USAGE, costUsd: 2 },
  };
  expect(reduce(active, { ...event, gen: active.gen - 1 }).state).toBe(active);
  expect(reduce(active, { ...event, matchId: 'another-match' }).state).toBe(active);
  expect(reduce(active, { ...event, botId: 'unknown' }).state).toBe(active);
  const results = finish(active);
  expect(reduce(results, { ...event, gen: active.gen - 1 }).state).toBe(results);
  expect(reduce(results, { ...event, botId: 'host' }).state).toBe(results);
  const newMatch = { ...results, matchId: 'new-match' };
  expect(reduce(newMatch, event).state).toBe(newMatch);
});

// protects=older direct engine guess events retain final semantics; fails_when=missing optional finalized accidentally becomes a draft; no_claim=does not validate legacy MCP input
test('legacy engine guess events are treated as final', () => {
  const state = activeRoom();
  const final = reduce(state, {
    type: 'bot_guess_recorded',
    matchId: state.matchId,
    gen: state.gen,
    roundNumber: 1,
    botId: botId(state),
    guess: { lat: TARGET.lat, lng: TARGET.lng, explanation: 'legacy' },
  }).state;
  expect(botResult(finish(final)).usedDraft).toBe(false);
  expect(guess(final, { lat: 0, lng: 0, explanation: 'late draft' })).toBe(final);
});
