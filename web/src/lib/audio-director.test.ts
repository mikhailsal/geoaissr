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

  cue(id: SoundId): void {
    this.cues.push(id);
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
      waitingFor: [],
      countdownStartsAt: startsAt,
      countdownSeconds: null,
      prepError,
    },
  });
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
  expect(output.cues).toEqual(['newRound', 'opponent', 'roundEnd', 'gameEnd']);
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
  expect(output.cues).toEqual(['roundEnd']);
});

test('music stops on deadline and on result', () => {
  const output = new FakeOutput();
  const director = new AudioDirector(output);
  director.update(view(), 10_000, true);
  expect(output.tracks.get('music')).toMatchObject({ offset: 10, loop: true });
  director.update(view(), 60_000, true);
  expect(output.tracks.has('music')).toBe(false);
  expect(output.tracks.has('warning')).toBe(false);
  director.update(view({ roundNumber: 2 }), 10_000, true);
  expect(output.tracks.has('music')).toBe(true);
  director.update(
    view({ roundNumber: 2, phase: 'ROUND_RESULTS', active: undefined }),
    11_000,
    true,
  );
  expect(output.tracks.has('music')).toBe(false);
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
  expect(output.cues).toEqual(['newRound']);
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
