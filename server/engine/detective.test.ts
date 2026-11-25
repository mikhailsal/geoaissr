import { expect, test } from 'bun:test';
import { buildQuotaMetric } from '../storage/quota.ts';
import type { HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { SettingsFile } from '../../shared/storage-schemas.ts';
import { patchJournalStep } from './journal.ts';
import { reduce } from './reduce.ts';
import { computeStartBlockedReasons, projectView } from './view.ts';
import {
  createInitialRoomState,
  type EngineEffect,
  type EngineEvent,
  type RoomState,
  type RoundTarget,
} from './types.ts';

const TARGET: RoundTarget = {
  panoId: 'pano-1',
  lat: 55.75,
  lng: 37.61,
  countryId: '643-eu',
  countryNameRu: 'Россия',
  map: 'standard',
  region: 'world',
  fakeSceneIndex: 0,
};

const CLAUDE: HarnessCatalogEntry = {
  id: 'claude',
  available: true,
  readsOwnerFiles: false,
  models: ['haiku'],
};

function makeRoom(
  roundDurationSec: number,
  availableHarnesses: HarnessCatalogEntry[] = [CLAUDE],
): RoomState {
  const settings: SettingsFile = {
    version: 2,
    map: 'standard',
    region: 'world',
    rounds: 1,
    roundDurationSec,
    moveEnabled: true,
    aiWaitWindowSec: 30,
    showMatchStandings: true,
    pushEnabled: false,
    pushSeconds: 15,
    allowBotPush: true,
    bots: [],
  };
  const quota = { used: 0, ceiling: 8000, worst: 2 };
  const base = createInitialRoomState({
    matchId: 'm1',
    fakeMode: true,
    settings,
    quotaSummary: {
      metrics: {
        static: buildQuotaMetric(0, 8000),
        pano: buildQuotaMetric(0, 4000),
        map: buildQuotaMetric(0, 8000),
      },
      staticUsed: quota.used,
      staticCeiling: quota.ceiling,
      staticWorstCase: 10,
      panoUsed: quota.used,
      panoCeiling: 4000,
      panoWorstCase: quota.worst,
      mapUsed: quota.used,
      mapCeiling: quota.ceiling,
      mapWorstCase: quota.worst,
      needsResetConfirm: false,
      sufficient: true,
    },
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses,
  });
  return reduce(
    base,
    { type: 'player_join', playerId: 'h', secret: 's', name: 'Хост', color: 'p-1', isHost: true },
    100,
  ).state;
}

/** A lobby with one bot; returns the room and the bot's id. */
function withBot(
  roundDurationSec: number,
  availableHarnesses?: HarnessCatalogEntry[],
): { room: RoomState; botId: string } {
  const base = makeRoom(roundDurationSec, availableHarnesses);
  const room = reduce(base, { type: 'add_bot', playerId: 'h' }, 110).state;
  return { room, botId: room.settings.bots[0]?.id ?? '' };
}

function patchBot(room: RoomState, botId: string, patch: Record<string, unknown>): RoomState {
  const out = reduce(room, { type: 'update_bot', playerId: 'h', botId, patch }, 120);
  expect(out.ack).toBe('ok');
  return out.state;
}

/** Plays the round up to ROUND_ACTIVE and returns every effect on the way. */
function startRound(room: RoomState): { room: RoomState; effects: EngineEffect[] } {
  const effects: EngineEffect[] = [];
  let s = room;
  const step = (event: EngineEvent, now: number): void => {
    const out = reduce(s, event, now);
    s = out.state;
    effects.push(...out.effects);
  };
  step({ type: 'start_match', playerId: 'h' }, 1000);
  step({ type: 'round_prepared', matchId: 'm1', gen: s.gen, roundNumber: 1, target: TARGET }, 1100);
  step({ type: 'pano_loaded', playerId: 'h', roundNumber: 1 }, 1200);
  step({ type: 'countdown_done', matchId: 'm1', gen: s.gen }, 10_000);
  return { room: s, effects };
}

test('a Detective slot keeps at least 90 s of budget; Intuit keeps the old floor', () => {
  const { room, botId } = withBot(60);
  expect(room.settings.bots[0]?.budgetSec).toBe(60);
  const detective = patchBot(room, botId, { playStyle: 'detective' });
  expect(detective.settings.bots[0]).toMatchObject({ playStyle: 'detective', budgetSec: 90 });
  // Lowering the budget of a Detective is not accepted.
  const lowered = patchBot(detective, botId, { budgetSec: 60 });
  expect(lowered.settings.bots[0]?.budgetSec).toBe(90);
  const intuit = patchBot(lowered, botId, { playStyle: 'intuit', budgetSec: 60 });
  expect(intuit.settings.bots[0]).toMatchObject({ playStyle: 'intuit', budgetSec: 60 });
  // An unknown style is ignored.
  expect(patchBot(intuit, botId, { playStyle: 'psychic' }).settings.bots[0]?.playStyle).toBe(
    'intuit',
  );
});

test('a round long enough runs the Detective; a shorter one runs the same bot as Intuit', () => {
  const long = withBot(120);
  const played = startRound(patchBot(long.room, long.botId, { playStyle: 'detective' }));
  expect(played.room.phase).toBe('ROUND_ACTIVE');
  expect(played.room.loadingOrActive?.bots[long.botId]?.playStyle).toBe('detective');
  expect(played.effects.some((e) => e.type === 'start_bot_processes')).toBe(true);
  const view = projectView(played.room, 'h');
  expect(view.active?.botProgress[0]?.playStyle).toBe('detective');
  // The round duration caps the budget at 60 s: the slot keeps its setting, the round does not.
  const short = withBot(60);
  const fallback = startRound(patchBot(short.room, short.botId, { playStyle: 'detective' }));
  expect(fallback.room.settings.bots[0]?.playStyle).toBe('detective');
  expect(fallback.room.loadingOrActive?.bots[short.botId]?.playStyle).toBeUndefined();
  const shortView = projectView(fallback.room, 'h');
  expect(shortView.active?.botProgress[0]?.playStyle).toBeUndefined();
});

test('a patch opens an exchange step, fills it in and never drops what the step has', () => {
  const request = { n: 1, kind: 'describe' as const, text: 'разметка' };
  const pending = [{ ...request, status: 'pending' as const }];
  let journal = patchJournalStep([], 1, { reason: 'версии', requests: pending }, 500);
  expect(journal).toEqual([
    {
      index: 1,
      kind: 'ask',
      frames: [],
      findingState: 'pending',
      atMs: 500,
      reason: 'версии',
      requests: pending,
    },
  ]);
  const settled = [{ ...request, status: 'answered' as const, value: 'белая', frame: 2 }];
  journal = patchJournalStep(journal, 1, { requests: settled }, 900);
  expect(journal[0]).toMatchObject({ reason: 'версии', atMs: 500, requests: settled });
  // Step 0 opened by a patch is the observe step, and steps stay in index order.
  journal = patchJournalStep(journal, 0, { report: [] }, 950);
  expect(journal.map((s) => [s.index, s.kind])).toEqual([
    [0, 'observe'],
    [1, 'ask'],
  ]);
});

test('the result card of a Detective carries the style, the exchanges, the confidence and the clue', () => {
  const { room, botId } = withBot(120);
  let s = startRound(patchBot(room, botId, { playStyle: 'detective' })).room;
  const ids = { matchId: 'm1', gen: s.gen, roundNumber: 1, botId };
  const feed = (event: EngineEvent, now: number): void => {
    s = reduce(s, event, now).state;
  };
  const thumb = { turn: 0, action: 'observe' as const, n: 1, label: 'С', thumbUrl: '/t1.jpg' };
  feed({ type: 'bot_thumb_added', ...ids, thumb }, 11_000);
  const report = [{ section: 'road' as const, text: 'Сторона движения: правая', frame: 1 }];
  feed({ type: 'bot_step_patched', ...ids, turn: 0, patch: { report } }, 12_000);
  const requests = [
    {
      n: 1,
      kind: 'text' as const,
      text: 'вывеска',
      status: 'abstained' as const,
      value: 'unreadable',
    },
  ];
  feed(
    { type: 'bot_step_patched', ...ids, turn: 1, patch: { reason: 'версии', requests } },
    13_000,
  );
  feed(
    { type: 'bot_finding', ...ids, turn: 0, findingState: 'recorded', finding: 'отчёт' },
    13_000,
  );
  const guess = {
    lat: 55.8,
    lng: 37.5,
    explanation: 'итог',
    summary: 'итог',
    confidence: 'region' as const,
    clue: 'Разметка.',
  };
  feed({ type: 'bot_guess_recorded', ...ids, guess, finalized: true }, 14_000);
  feed({ type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 55.7, lng: 37.6 }, 15_000);
  feed({ type: 'bot_finished', ...ids, aborted: false, reason: 'завершил ход' }, 16_000);
  expect(s.phase).toBe('ROUND_RESULTS');
  const journal = s.results?.entries.find((e) => e.id === botId)?.journal;
  expect(journal).toMatchObject({ style: 'detective', confidence: 'region', clue: 'Разметка.' });
  expect(journal?.steps.map((step) => [step.index, step.kind, step.atMs])).toEqual([
    [0, 'observe', 1000],
    [1, 'ask', 3000],
  ]);
  expect(journal?.steps[0]).toMatchObject({ report, finding: 'отчёт' });
  expect(journal?.steps[0]?.frames[0]).toMatchObject({ n: 1, action: 'observe' });
  expect(journal?.steps[1]).toMatchObject({ reason: 'версии', requests });
});

/** A Detective round in play with the bot's guess recorded as final or as a checkpoint. */
function roundWithGuess(finalized: boolean): {
  room: RoomState;
  botId: string;
  ids: { matchId: string; gen: number; roundNumber: number; botId: string };
} {
  const { room, botId } = withBot(120);
  const started = startRound(patchBot(room, botId, { playStyle: 'detective' })).room;
  const ids = { matchId: 'm1', gen: started.gen, roundNumber: 1, botId };
  const guess = { lat: 55.8, lng: 37.5, explanation: 'итог', summary: 'итог' };
  const withGuess = reduce(
    started,
    { type: 'bot_guess_recorded', ...ids, guess, finalized },
    14_000,
  ).state;
  return { room: withGuess, botId, ids };
}

// Value: protects=a bot whose final guess is in is shown as finished when the round ends while its processes still exit (a Detective waits for its eyes' tokens); fails_when=the card says the bot ran out of time although it answered; why_new=the round end marked every thinking bot as timed out; seam=none; no_claim=how long the processes take to exit.
test('the round end counts a bot with its final guess as done and one with a checkpoint as timed out', () => {
  const answered = roundWithGuess(true);
  const tick = { type: 'deadline_tick' as const, matchId: 'm1', kind: 'round' as const };
  const done = reduce(answered.room, { ...tick, gen: answered.ids.gen }, 130_000);
  expect(done.state.phase).toBe('ROUND_RESULTS');
  const card = done.state.results?.entries.find((e) => e.id === answered.botId);
  expect(card?.terminationReason).toBe('завершил ход');
  const aborted = done.effects.flatMap((e) => ('abortedBots' in e ? e.abortedBots : []));
  expect(aborted).toEqual([]);

  const draft = roundWithGuess(false);
  const late = reduce(draft.room, { ...tick, gen: draft.ids.gen }, 130_000);
  const lateCard = late.state.results?.entries.find((e) => e.id === draft.botId);
  expect(lateCard?.terminationReason).toBe('истекло время раунда');
  expect(late.effects.flatMap((e) => ('abortedBots' in e ? e.abortedBots : []))).toHaveLength(1);
});

test('the bot budget ending stops the processes of an answered bot without calling it a timeout', () => {
  const { room, botId, ids } = roundWithGuess(true);
  const out = reduce(
    room,
    { type: 'deadline_tick', matchId: 'm1', gen: ids.gen, kind: 'bot_budget', botId },
    100_000,
  );
  expect(out.state.loadingOrActive?.bots[botId]).toMatchObject({
    status: 'done',
    terminationReason: 'завершил ход',
    finishedAt: 100_000,
  });
  expect(out.state.loadingOrActive?.bots[botId]?.abortReason).toBeUndefined();
  expect(out.effects.find((e) => e.type === 'stop_bot_process')).toMatchObject({ botId });

  const draft = roundWithGuess(false);
  const cut = reduce(
    draft.room,
    {
      type: 'deadline_tick',
      matchId: 'm1',
      gen: draft.ids.gen,
      kind: 'bot_budget',
      botId: draft.botId,
    },
    100_000,
  );
  expect(cut.state.loadingOrActive?.bots[draft.botId]).toMatchObject({
    status: 'aborted',
    terminationReason: 'истек бюджет времени',
  });
});

const CODEX: HarnessCatalogEntry = {
  id: 'codex',
  available: true,
  readsOwnerFiles: false,
  models: ['gpt-6-luna', 'gpt-6-sol'],
};
const AGY_MISSING: HarnessCatalogEntry = {
  id: 'agy',
  available: false,
  reason: 'agy не найден',
  readsOwnerFiles: true,
  models: [],
};

/** A Detective in the lobby with claude, codex and a missing agy. */
function detectiveLobby(): { room: RoomState; botId: string } {
  const { room, botId } = withBot(120, [CLAUDE, CODEX, AGY_MISSING]);
  return { room: patchBot(room, botId, { playStyle: 'detective' }), botId };
}

// Value: protects=the host's choice of where the eyes of a Detective run; fails_when=the eyes land on a missing harness, lose their model on an unrelated edit, or keep a model after «как у мозга»; why_new=the eyes had no settings of their own; seam=none; no_claim=how the picker renders.
test('the eyes move to a harness of their own, keep their model and come back to the brain', () => {
  const { room, botId } = detectiveLobby();
  const onCodex = patchBot(room, botId, { eyes: { harness: 'codex' } });
  // No model named: the first one of the harness.
  expect(onCodex.settings.bots[0]?.eyes).toEqual({ harness: 'codex', model: 'gpt-6-luna' });
  const sol = patchBot(onCodex, botId, { eyes: { harness: 'codex', model: 'gpt-6-sol' } });
  expect(sol.settings.bots[0]?.eyes?.model).toBe('gpt-6-sol');
  // The same harness again keeps the chosen model; an edit of the brain leaves the eyes alone.
  const again = patchBot(sol, botId, { eyes: { harness: 'codex' }, effort: 'high' });
  expect(again.settings.bots[0]).toMatchObject({
    effort: 'high',
    enabled: true,
    eyes: { harness: 'codex', model: 'gpt-6-sol' },
  });
  const back = patchBot(again, botId, { eyes: null });
  expect(back.settings.bots[0]?.eyes).toBeUndefined();
  // A harness that is not installed is refused, and the slot is unchanged.
  const refused = reduce(
    back,
    { type: 'update_bot', playerId: 'h', botId, patch: { eyes: { harness: 'agy' } } },
    130,
  );
  expect(refused.ack).toBe('invalid');
  expect(refused.state.settings.bots[0]?.eyes).toBeUndefined();
});

test('a stored vision check of a Detective follows its eyes, not its brain', () => {
  const { room, botId } = detectiveLobby();
  const split = patchBot(room, botId, { eyes: { harness: 'codex' } });
  const bot = split.settings.bots[0];
  const check = {
    passed: true,
    elapsedMs: 900,
    model: 'gpt-6-luna',
    effort: 'low' as const,
    imageSize: bot?.imageSize ?? 400,
    checkedAt: '2026-11-24T10:00:00.000Z',
  };
  const checked = reduce(split, { type: 'update_bot_vision_check', botId, check }, 140).state;
  // The brain thinks harder: the eyes still see at low effort, so the check still counts.
  const brainEdit = patchBot(checked, botId, { effort: 'high' });
  expect(brainEdit.settings.bots[0]?.lastVisionCheck).toEqual(check);
  const eyesEdit = patchBot(brainEdit, botId, { eyes: { harness: 'codex', model: 'gpt-6-sol' } });
  expect(eyesEdit.settings.bots[0]?.lastVisionCheck).toBeUndefined();
});

// Value: protects=the eyes' effort is a setting of its own; fails_when=the patch ignores eyesEffort, marks the brain's preset as custom, or a vision check made at the old eyes effort still counts; why_new=the eyes always looked at low; seam=none; no_claim=how the picker renders.
test('the eyes of a Detective get their own effort, and a check at the old one stops counting', () => {
  const { room, botId } = detectiveLobby();
  const bot = room.settings.bots[0];
  const check = {
    passed: true,
    elapsedMs: 900,
    model: bot?.model ?? '',
    effort: 'low' as const,
    imageSize: bot?.imageSize ?? 400,
    checkedAt: '2026-11-24T10:00:00.000Z',
  };
  const checked = reduce(room, { type: 'update_bot_vision_check', botId, check }, 140).state;
  const preset = checked.settings.bots[0]?.difficultyPreset;
  const medium = patchBot(checked, botId, { eyesEffort: 'medium' });
  expect(medium.settings.bots[0]).toMatchObject({
    eyesEffort: 'medium',
    effort: bot?.effort,
    difficultyPreset: preset,
  });
  expect(medium.settings.bots[0]?.lastVisionCheck).toBeUndefined();
});

// Value: protects=«Проверить зрение» results stay tied to the CLI that ran them; fails_when=the eyes move to another harness that lists the same model id and the old check still shows as passed; why_new=the stored check names no harness and only the model was compared; seam=none; no_claim=how a real agy install names its models.
test('a vision check does not follow the eyes to another harness with the same model id', () => {
  const agy: HarnessCatalogEntry = { ...AGY_MISSING, available: true, models: ['haiku'] };
  const { room, botId } = withBot(120, [CLAUDE, CODEX, agy]);
  const detective = patchBot(room, botId, { playStyle: 'detective' });
  const model = detective.settings.bots[0]?.model ?? '';
  const check = {
    passed: true,
    elapsedMs: 900,
    model,
    effort: 'low' as const,
    imageSize: detective.settings.bots[0]?.imageSize ?? 400,
    checkedAt: '2026-11-24T10:00:00.000Z',
  };
  const checked = reduce(detective, { type: 'update_bot_vision_check', botId, check }, 140).state;
  // The brain's own harness with the same model: the eyes did not change, the check stays.
  const same = patchBot(checked, botId, { eyes: { harness: 'claude', model } });
  expect(same.settings.bots[0]?.lastVisionCheck).toEqual(check);
  const moved = patchBot(same, botId, { eyes: { harness: 'agy', model } });
  expect(moved.settings.bots[0]?.eyes).toEqual({ harness: 'agy', model });
  expect(moved.settings.bots[0]?.lastVisionCheck).toBeUndefined();
});

test('a Detective whose eyes harness is gone blocks the start and is disabled on edit', () => {
  const { room, botId } = detectiveLobby();
  const split = patchBot(room, botId, { eyes: { harness: 'codex' } });
  const gone = {
    ...split,
    availableHarnesses: [CLAUDE, { ...CODEX, available: false, reason: 'codex не найден' }],
  };
  // The lobby names the bot, as it does for a missing brain harness, and the match does not start.
  const reasons = computeStartBlockedReasons(gone);
  expect(reasons).toHaveLength(1);
  expect(reasons[0]).toMatch(/^ИИ-бот «.+» недоступен в текущей среде$/);
  const start = reduce(gone, { type: 'start_match', playerId: 'h' }, 1000);
  expect(start.ack).toBe('invalid');
  expect(start.effects.some((e) => e.type === 'start_bot_processes')).toBe(false);
  // The next edit of the slot says why it cannot play, and the start is free again.
  const edited = patchBot(gone, botId, { name: 'Сыщик' });
  expect(edited.settings.bots[0]).toMatchObject({
    enabled: false,
    disabledReason: 'Глаза детектива: codex не найден',
  });
  expect(computeStartBlockedReasons(edited)).toEqual([]);
  // A Detective in a round too short for it plays Intuit and needs only the brain's harness.
  const short = { ...gone, settings: { ...gone.settings, roundDurationSec: 60 } };
  expect(computeStartBlockedReasons(short)).toEqual([]);
});

test('a brain that could open the frames is marked on the result card', () => {
  const { room, botId, ids } = roundWithGuess(true);
  const marked = reduce(room, { type: 'bot_isolation_unconfirmed', ...ids }, 20_000).state;
  const s = reduce(
    reduce(marked, { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 1, lng: 1 }, 21_000)
      .state,
    { type: 'bot_finished', ...ids, aborted: false, reason: 'завершил ход' },
    22_000,
  ).state;
  const journal = s.results?.entries.find((e) => e.id === botId)?.journal;
  expect(journal).toMatchObject({ style: 'detective', isolation: 'unconfirmed' });
  const clean = roundWithGuess(true);
  const plain = reduce(
    reduce(
      clean.room,
      { type: 'submit_guess', playerId: 'h', roundNumber: 1, lat: 1, lng: 1 },
      21_000,
    ).state,
    { type: 'bot_finished', ...clean.ids, aborted: false, reason: 'завершил ход' },
    22_000,
  ).state;
  expect(plain.results?.entries.find((e) => e.id === clean.botId)?.journal?.isolation).toBe(
    undefined,
  );
});
