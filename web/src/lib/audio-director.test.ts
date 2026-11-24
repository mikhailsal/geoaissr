import { expect, test } from 'bun:test';
import type { ClientViewState, PlayerView, BotRoundProgressView } from '../../../shared/protocol';
import type { AudioOutput, SoundId } from './audio-catalog';
import { AudioDirector } from './audio-director';

// Value: protects=live audio event selection and synchronized track lifetimes; fails_when=events duplicate or stale tracks survive state changes; why_new=game state had no audio coverage; seam=none; no_claim=the output fake does not decode audio or exercise browser lifecycle events.

type Track = { id: SoundId; key: string; offset: number; loop?: boolean };
class FakeOutput implements AudioOutput {
  cues: SoundId[] = [];
  tracks = new Map<string, Track>();
  starts: Track[] = [];
  musicRequests: { key: string; lobby: boolean }[] = [];

  cue(id: SoundId): void {
    this.cues.push(id);
  }
  music(key: string, lobby = false): void {
    this.musicRequests.push({ key, lobby });
    this.track('music', 'music', key, 0, true);
  }
  track(channel: string, id: SoundId, key: string, offset: number, loop?: boolean): void {
    if (this.tracks.get(channel)?.key === key) return;
    const track = { id, key, offset, loop };
    this.tracks.set(channel, track);
    this.starts.push(track);
  }
  stop(channel: string): void {
    this.tracks.delete(channel);
  }
  stopAll(): void {
    this.tracks.clear();
  }
}

function view(overrides: Partial<ClientViewState> = {}): ClientViewState {
  return {
    matchId: 'match',
    roundNumber: 1,
    roundDurationSec: 60,
    gen: 1,
    viewerId: 'me',
    viewerIsSpectator: false,
    players: [],
    phase: 'ROUND_ACTIVE',
    active: {
      panoId: 'pano',
      fakeSceneIndex: 0,
      endsAt: 60_000,
      allHumansConfirmed: false,
      myPin: null,
      myConfirmed: false,
      confirmedCount: 0,
      playingHumanCount: 1,
      botProgress: [],
    },
    ...overrides,
  } as ClientViewState;
}

function player(id: string, confirmed: boolean): PlayerView {
  return { id, confirmed } as PlayerView;
}
function bot(id: string, status: BotRoundProgressView['status']): BotRoundProgressView {
  return { id, status } as BotRoundProgressView;
}
function activeWith(changes: Partial<NonNullable<ClientViewState['active']>>): ClientViewState {
  const base = view();
  return view({
    active: { ...(base.active as NonNullable<ClientViewState['active']>), ...changes },
  });
}
function loading(startsAt: number | null, prepError?: string): ClientViewState {
  return view({
    phase: 'ROUND_LOADING',
    active: undefined,
    loading: {
      startedLoadingAt: 1_000,
      waitingFor: [],
      countdownStartsAt: startsAt,
      countdownSeconds: null,
      prepError,
    },
  });
}

function resultsAt(finishedAt: number, confirmedIds: string[] = []): ClientViewState {
  const results = {
    targetLat: 48.8566,
    targetLng: 2.3522,
    countryNameRu: 'Франция',
    matchLeaders: [],
    entries: [],
    completion: { finishedAt, confirmedIds },
    humanVsAi: { visible: false, humansRound: 0, aiRound: 0, humansTotal: 0, aiTotal: 0 },
  };
  return view({ phase: 'ROUND_RESULTS', gen: 2, active: undefined, results });
}

test('announces live transitions and coalesces new opponents without duplicates', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(loading(0), 0, true);
  director.update(view(), 3_000, true);
  const done = activeWith({ botProgress: [bot('bot1', 'done'), bot('bot2', 'done')] });
  done.players = [player('me', true), player('other', true)];
  director.update(done, 4_000, true);
  director.update(done, 5_000, true);
  director.update(done, 6_000, true);
  expect(output.cues).toEqual(['newRound', 'opponent']);
  expect(output.starts.filter((track) => track.id === 'music')).toHaveLength(1);
  director.update(view({ phase: 'ROUND_RESULTS', active: undefined }), 60_000, true);
  director.update(view({ phase: 'ROUND_RESULTS', active: undefined }), 61_000, true);
  director.update(
    view({
      phase: 'FINAL',
      active: undefined,
      final: {
        playedRounds: 1,
        plannedRounds: 1,
        standings: [],
        humanVsAi: { visible: false, humansTotal: 0, aiTotal: 0 },
      },
    }),
    62_000,
    true,
  );
  expect(output.cues).toEqual([
    'newRound',
    'opponent',
    'transition',
    'roundEnd',
    'transition',
    'gameEnd',
  ]);
});

test('initial and restored snapshots do not announce historical events', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  const done = activeWith({ botProgress: [bot('bot', 'done')] });
  done.players = [player('other', true)];
  director.update(done, 10_000, true);
  director.update(null, 11_000, false);
  director.update(done, 12_000, true);
  director.update(done, 13_000, false);
  director.update(done, 14_000, true);
  expect(output.cues).toEqual([]);
  director.update(view({ phase: 'ROUND_RESULTS', active: undefined }), 15_000, true);
  expect(output.cues).toEqual(['transition', 'roundEnd']);
});

test('music continues through zero, results and the next intro, stopping at the match final', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 10_000, true);
  expect(output.tracks.get('music')).toMatchObject({ key: 'game:match', loop: true });
  director.update(view(), 60_000, true);
  expect(output.tracks.has('music')).toBe(true);
  expect(output.tracks.has('warning')).toBe(false);
  director.update(view({ phase: 'ROUND_RESULTS', active: undefined }), 61_000, true);
  expect(output.tracks.get('music')).toMatchObject({ key: 'game:match', loop: true });
  director.update({ ...loading(null), roundNumber: 2 }, 62_000, true);
  expect(output.tracks.get('music')).toMatchObject({ key: 'game:match', loop: true });
  director.update(view({ roundNumber: 2 }), 72_000, true);
  expect(output.tracks.get('music')).toMatchObject({ id: 'music', key: 'game:match' });
  expect(output.starts.filter((track) => track.key === 'game:match')).toHaveLength(1);
  director.update(view({ phase: 'FINAL', active: undefined }), 80_000, true);
  expect(output.tracks.has('music')).toBe(false);
});

test('lobby requests one calm loop and a new game gets a separate playlist session', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  const lobby = view({ phase: 'LOBBY', active: undefined });
  director.update(lobby, 0, true);
  director.update(lobby, 90_000, true);
  expect(output.tracks.get('music')).toMatchObject({ id: 'music', key: 'lobby:match' });
  expect(output.musicRequests.at(-1)).toEqual({ key: 'lobby:match', lobby: true });
  expect(output.starts).toHaveLength(1);
  director.update(loading(null), 91_000, true);
  director.update(view({ roundNumber: 3 }), 250_000, true);
  expect(output.tracks.get('music')).toMatchObject({ id: 'music', key: 'game:match' });
  expect(output.musicRequests.at(-1)).toEqual({ key: 'game:match', lobby: false });
  director.update(view({ phase: 'FINAL', active: undefined }), 251_000, true);
  expect(output.tracks.has('music')).toBe(false);
  director.update(lobby, 252_000, true);
  expect(output.tracks.get('music')).toMatchObject({ id: 'music', key: 'lobby:match' });
});

test('expired warning keeps its final hit and tail across zero and results without restarting', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 55_000, true);
  director.update(view(), 60_000, true);
  director.update(view({ phase: 'ROUND_RESULTS', active: undefined }), 60_050, true);
  director.update(view({ phase: 'FINAL', active: undefined }), 61_000, true);
  expect(output.tracks.get('warning')).toMatchObject({ key: 'match:1:60000' });
  expect(output.starts.filter((track) => track.id === 'warning')).toHaveLength(1);
  director.update(null, 61_100, false);
  expect(output.tracks.size).toBe(0);
});

test('early results cancel an unexpired personal warning', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 55_000, true);
  director.update(view({ phase: 'ROUND_RESULTS', active: undefined }), 56_000, true);
  expect(output.tracks.has('warning')).toBe(false);
  expect(output.tracks.has('music')).toBe(true);
});

test('a scheduled countdown lets the loading phrase finish and keeps its go tail', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view({ phase: 'LOBBY', active: undefined }), 0, true);
  director.update(loading(null), 1_000, true);
  director.update(loading(7_800), 1_500, true);
  expect(output.tracks.has('loading')).toBe(true);
  expect(output.tracks.has('countdown')).toBe(false);
  director.update(loading(7_800), 7_800, true);
  expect(output.tracks.has('loading')).toBe(true);
  expect(output.tracks.get('countdown')).toMatchObject({ offset: 0 });
  director.update(view(), 10_800, true);
  expect(output.tracks.has('countdown')).toBe(true);
});

test('a coalesced first loading snapshot starts the phrase at the server-aligned offset', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view({ phase: 'LOBBY', active: undefined }), 0, true);
  director.update(loading(7_800), 1_500, true);
  expect(output.tracks.get('loading')).toMatchObject({ offset: 0.5 });
  expect(output.tracks.has('countdown')).toBe(false);
});

test('warning seeks into final 15 seconds and restarts for a shortened deadline', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 44_999, true);
  expect(output.tracks.has('warning')).toBe(false);
  director.update(view(), 48_000, true);
  expect(output.tracks.get('warning')).toMatchObject({ offset: 3, key: 'match:1:60000' });
  director.update(view(), 49_000, true);
  expect(output.starts.filter((track) => track.id === 'warning')).toHaveLength(1);
  director.update(activeWith({ endsAt: 55_000 }), 49_000, true);
  expect(output.tracks.get('warning')).toMatchObject({ offset: 9, key: 'match:1:55000' });
});

test('confirmation and spectating suppress personal warnings', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 50_000, true);
  expect(output.tracks.has('warning')).toBe(true);
  director.update(activeWith({ myConfirmed: true }), 51_000, true);
  expect(output.tracks.has('warning')).toBe(false);
  director.update(view({ viewerIsSpectator: true }), 52_000, true);
  expect(output.tracks.has('warning')).toBe(false);
});

test('countdown seeks on snapshot and stops on prep error or phase exit', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(loading(10_000), 11_500, true);
  expect(output.tracks.get('countdown')).toMatchObject({ offset: 1.5 });
  director.update(loading(10_000, 'failed'), 11_600, true);
  expect(output.tracks.has('countdown')).toBe(false);
  director.update(loading(20_000), 20_500, true);
  expect(output.tracks.get('countdown')).toMatchObject({ offset: 0.5 });
  director.update(view({ phase: 'ROUND_RESULTS', active: undefined }), 21_000, true);
  expect(output.tracks.has('countdown')).toBe(false);
});

test('next round announces its active phase once', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view({ phase: 'ROUND_RESULTS', active: undefined }), 0, true);
  director.update({ ...loading(null), roundNumber: 2 }, 1_000, true);
  director.update({ ...view(), roundNumber: 2 }, 2_000, true);
  director.update({ ...view(), roundNumber: 2 }, 3_000, true);
  expect(output.cues).toEqual(['transition', 'newRound']);
});

test('screen changes swoosh once, while revealing an active round keeps only its start cue', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  const lobby = view({ phase: 'LOBBY', active: undefined });
  const results = view({ phase: 'ROUND_RESULTS', active: undefined });
  director.update(lobby, 0, true);
  expect(output.cues).toEqual([]);
  for (const [index, snapshot] of [
    loading(1_000),
    view(),
    results,
    { ...loading(10_000), roundNumber: 2 },
    view({ roundNumber: 2 }),
    { ...results, roundNumber: 2 },
    view({ phase: 'FINAL', active: undefined }),
    lobby,
  ].entries()) {
    director.update(snapshot, (index + 1) * 1_000, true);
    director.update(snapshot, (index + 1) * 1_000 + 100, true);
  }
  expect(output.cues).toEqual([
    'transition',
    'newRound',
    'transition',
    'roundEnd',
    'transition',
    'newRound',
    'transition',
    'roundEnd',
    'transition',
    'transition',
  ]);
});

for (const kind of ['human', 'bot'] as const) {
  test(`announces an isolated ${kind} confirmation once`, () => {
    const output = new FakeOutput();
    const director = new AudioDirector(output);
    const initial = activeWith({ botProgress: [bot('ai', 'thinking')] });
    initial.players = [player('me', false), player('other', false)];
    director.update(initial, 0, true);
    if (!initial.active) throw new Error('Missing active fixture');
    const confirmed =
      kind === 'human'
        ? { ...initial, players: [player('me', false), player('other', true)] }
        : { ...initial, active: { ...initial.active, botProgress: [bot('ai', 'done')] } };
    director.update(confirmed, 1_000, true);
    director.update(confirmed, 1_250, true);
    expect(output.cues).toEqual(['opponent']);
  });
}

// Value: protects=one live loading phrase per attempt; fails_when=a same-round retry is silent or repeats; why_new=phase changes alone do not identify retries; seam=none; no_claim=the output fake does not exercise browser decoding.
test('live loading retries play one new phrase without a screen transition', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view({ phase: 'LOBBY', active: undefined }), 0, true);
  director.update(loading(null), 1_000, true);
  director.update(loading(null, 'failed'), 2_000, true);
  const retry = loading(9_800);
  if (!retry.loading) throw new Error('Missing loading fixture');
  retry.gen = 2;
  retry.loading.startedLoadingAt = 3_000;
  director.update(retry, 3_500, true);
  director.update(retry, 4_000, true);
  output.tracks.delete('loading');
  director.update(retry, 9_799, true);
  expect(output.starts.filter((track) => track.id === 'loading')).toEqual([
    { id: 'loading', key: 'match:1:1', offset: 0, loop: undefined },
    { id: 'loading', key: 'match:1:2', offset: 0.5, loop: undefined },
  ]);
  expect(output.cues).toEqual(['transition']);
});

test('initial and restored loading generations leave the intro phrase silent', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(loading(null), 1_000, true);
  director.update(loading(null), 1_500, true);
  director.update(null, 2_000, false);
  const restored = { ...loading(null), gen: 2 };
  director.update(restored, 2_500, true);
  director.update(restored, 2_600, true);
  expect(output.starts.filter((track) => track.id === 'loading')).toEqual([]);
  expect(output.cues).toEqual([]);
});

// Value: protects=countdown cancellation when a host ends the match; fails_when=the countdown continues over the final screen; why_new=the existing loading exit test covers results; seam=none; no_claim=the output fake does not exercise native audio playback.
test('ending the match during loading cancels its running countdown', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(loading(10_000), 10_500, true);
  expect(output.tracks.get('countdown')?.offset).toBe(0.5);
  director.update(view({ phase: 'FINAL', gen: 2, active: undefined }), 11_000, true);
  expect(output.tracks.has('countdown')).toBe(false);
});

// Value: protects=warning tails at the authoritative deadline; fails_when=clock skew changes cutoff; why_new=legacy results fixtures compare only estimated time; seam=none; no_claim=the output fake does not exercise sample-level playback.
test('server timeout lets the warning finish when the client estimate is behind', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 55_000, true);
  director.update(resultsAt(60_000), 59_500, true);
  expect(output.tracks.get('warning')?.key).toBe('match:1:60000');
  director.update(view({ phase: 'FINAL', active: undefined }), 59_800, true);
  expect(output.tracks.get('warning')?.key).toBe('match:1:60000');
  expect(output.starts.filter((track) => track.id === 'warning')).toHaveLength(1);
});

test('early completion cuts the warning when the client estimate is ahead', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 55_000, true);
  expect(output.tracks.has('warning')).toBe(true);
  director.update(resultsAt(59_500, ['me']), 60_100, true);
  expect(output.tracks.has('warning')).toBe(false);
  expect(output.tracks.has('music')).toBe(true);
});

// Value: protects=last live human and bot confirmation cues; fails_when=the reducer skips the final active snapshot or results replay prior confirmations; why_new=active-to-active tests miss the boundary; seam=none; no_claim=the output fake does not exercise WebSocket readiness.
for (const kind of ['human', 'bot'] as const) {
  test(`announces the last ${kind} once when the round completes directly`, () => {
    const output = new FakeOutput();
    const director = new AudioDirector(output);
    const lastOpponent = kind === 'human' ? 'last-human' : 'last-bot';
    const initial = activeWith({
      myConfirmed: true,
      botProgress: kind === 'bot' ? [bot(lastOpponent, 'thinking')] : [],
    });
    initial.players = [player('me', true), player('heard', true)];
    if (kind === 'human') initial.players.push(player(lastOpponent, false));
    director.update(initial, 55_000, true);
    const results = resultsAt(56_000, ['me', 'heard', lastOpponent]);
    director.update(results, 56_000, true);
    director.update(results, 56_100, true);
    expect(output.cues).toEqual(['transition', 'roundEnd', 'opponent']);
  });
}

test('results do not replay the viewer, heard confirmations or restored confirmations', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 1_000, true);
  director.update(view({ players: [player('heard', true)] }), 2_000, true);
  director.update(resultsAt(3_000, ['me', 'heard']), 3_000, true);
  expect(output.cues).toEqual(['opponent', 'transition', 'roundEnd']);

  director.update(view({ roundNumber: 2, gen: 3 }), 4_000, true);
  const restored = { ...resultsAt(5_000, ['missed']), roundNumber: 2, gen: 4 };
  const beforeDisconnect = [...output.cues];
  director.update(null, 4_500, false);
  director.update(restored, 5_000, true);
  director.update(restored, 5_100, true);
  expect(output.cues).toEqual(beforeDisconnect);
});
