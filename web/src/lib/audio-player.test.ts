import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AUDIO, audioUrl, ROUND_MUSIC, roundMusic } from './audio-catalog';
import { AudioPlayer } from './audio-player';

// Value: protects=muting and invalidation cancel pending playback; fails_when=an invalidated load starts a native source or failures block retries; why_new=no prior audio engine existed; seam=none; no_claim=fake audio objects do not prove browser decoding or speaker output.

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a value');
  return value;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  starts: number[] = [];
  stopped = false;
  connect(gain: FakeGain): FakeGain {
    return gain;
  }
  disconnect(): void {}
  start(_when: number, offset: number): void {
    this.starts.push(offset);
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeGain {
  gain = { value: 0 };
  connect(): void {}
  disconnect(): void {}
}

class FakeContext {
  static instances: FakeContext[] = [];
  state = 'running';
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  decode: () => Promise<AudioBuffer> = () => Promise.resolve({ duration: 10 } as AudioBuffer);
  constructor() {
    FakeContext.instances.push(this);
  }
  async resume(): Promise<void> {}
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  decodeAudioData(): Promise<AudioBuffer> {
    return this.decode();
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
const originalFetch = globalThis.fetch;
const enabled = { effects: true, music: true };
const response = (): Response => new Response(new Uint8Array([1]));
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  FakeContext.instances = [];
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeContext,
  });
  globalThis.fetch = Object.assign(() => Promise.resolve(response()), {
    preconnect: originalFetch.preconnect,
  });
});

afterEach(() => {
  if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext);
  else Reflect.deleteProperty(globalThis, 'AudioContext');
  globalThis.fetch = originalFetch;
});

test('does not construct a context or fetch before unlock; missing AudioContext is safe', async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    () => {
      requests++;
      return Promise.resolve(response());
    },
    { preconnect: originalFetch.preconnect },
  );
  const player = new AudioPlayer();
  player.configure(enabled, true);
  player.cue('click');
  player.track('music', 'music', 'round', 0, true);
  expect(FakeContext.instances).toHaveLength(0);
  expect(requests).toBe(0);
  Reflect.deleteProperty(globalThis, 'AudioContext');
  await player.unlock();
  player.cue('click');
  player.destroy();
  expect(requests).toBe(0);
});

for (const action of ['stop', 'mute', 'inactive', 'destroy'] as const) {
  test(`does not start a pending fetch after ${action}`, async () => {
    const pending = deferred<Response>();
    globalThis.fetch = (async (url: string | URL | Request) =>
      (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url) ===
      audioUrl('music')
        ? pending.promise
        : response()) as typeof fetch;
    const player = new AudioPlayer();
    player.configure(enabled, true);
    await player.unlock();
    const context = required(FakeContext.instances[0]);
    player.track('music', 'music', 'round', 0, true);
    if (action === 'stop') player.stop('music');
    if (action === 'mute') player.configure({ effects: true, music: false }, true);
    if (action === 'inactive') player.configure(enabled, false);
    if (action === 'destroy') player.destroy();
    pending.resolve(response());
    await settle();
    expect(context.sources).toHaveLength(0);
    player.destroy();
  });
}

test('does not start a pending decode after it is stopped', async () => {
  const pending = deferred<AudioBuffer>();
  const pendingFetch = deferred<Response>();
  globalThis.fetch = (async (url: string | URL | Request) =>
    (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url) === audioUrl('music')
      ? pendingFetch.promise
      : response()) as typeof fetch;
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  const context = required(FakeContext.instances[0]);
  context.decode = () => pending.promise;
  pendingFetch.resolve(response());
  await settle();
  player.track('late', 'music', 'round', 0, true);
  player.stop('late');
  pending.resolve({ duration: 10 } as AudioBuffer);
  await settle();
  expect(context.sources).toHaveLength(0);
  player.destroy();
});

for (const failure of ['fetch', 'decode'] as const) {
  test(`silently retries after ${failure} failure`, async () => {
    let attempts = 0;
    const pendingFetch = deferred<Response>();
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url) ===
          audioUrl('music') &&
        ++attempts === 1
      ) {
        if (failure === 'fetch') throw new Error('offline');
        return pendingFetch.promise;
      }
      return response();
    }) as typeof fetch;
    const player = new AudioPlayer();
    player.configure(enabled, true);
    await player.unlock();
    const context = required(FakeContext.instances[0]);
    if (failure === 'decode') {
      await settle();
      let first = true;
      context.decode = () => {
        if (first) {
          first = false;
          return Promise.reject(new Error('bad audio'));
        }
        return Promise.resolve({ duration: 10 } as AudioBuffer);
      };
      pendingFetch.resolve(response());
    }
    await settle();
    player.track('music', 'music', 'round', 0, true);
    await settle();
    expect(context.sources).toHaveLength(1);
    expect(attempts).toBeGreaterThanOrEqual(2);
    player.destroy();
  });
}

test('loops with wrapped offset and gain, deduplicates keys, and plays one-shots', async () => {
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  await settle();
  const context = required(FakeContext.instances[0]);
  player.track('music', 'music', 'round', 12, true);
  await settle();
  expect(context.sources).toHaveLength(1);
  expect(required(context.sources[0]).loop).toBe(true);
  expect(required(context.sources[0]).starts[0] ?? -1).toBeGreaterThanOrEqual(2);
  expect(required(context.sources[0]).starts[0] ?? -1).toBeLessThan(3);
  expect(required(context.gains[0]).gain.value).toBe(AUDIO.music[1]);
  player.track('music', 'music', 'round', 12, true);
  await settle();
  expect(context.sources).toHaveLength(1);
  player.track('music', 'music', 'next', 1);
  await settle();
  expect(required(context.sources[0]).stopped).toBe(true);
  expect(required(context.sources[1]).loop).toBe(false);
  expect(required(context.sources[1]).starts[0] ?? -1).toBeGreaterThanOrEqual(1);
  player.cue('click');
  await settle();
  expect(required(context.sources[2]).starts).toEqual([0]);
  expect(required(context.gains[2]).gain.value).toBe(AUDIO.click[1]);
  player.destroy();
});

test('all seven round variants use the independent music preference and cycle in order', async () => {
  expect(Array.from({ length: 14 }, (_, index) => roundMusic(index + 1))).toEqual([
    ...ROUND_MUSIC,
    ...ROUND_MUSIC,
  ]);
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  await settle();
  const context = required(FakeContext.instances[0]);
  for (const id of ROUND_MUSIC) player.track(id, id, id, 0, true);
  player.cue('click');
  await settle();
  expect(context.sources).toHaveLength(8);
  player.configure({ effects: false, music: true }, true);
  expect(context.sources.slice(0, 7).every((source) => !source.stopped)).toBe(true);
  expect(required(context.sources[7]).stopped).toBe(true);
  player.configure({ effects: true, music: false }, true);
  expect(context.sources.every((source) => source.stopped)).toBe(true);
  player.destroy();
});

for (const outcome of ['ready', 'failed', 'muted'] as const) {
  test(`keeps current music while the next variant loads; handles ${outcome}`, async () => {
    const pending = deferred<Response>();
    globalThis.fetch = (async (url: string | URL | Request) =>
      (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url) ===
      audioUrl('musicExplorer')
        ? pending.promise
        : response()) as typeof fetch;
    const player = new AudioPlayer();
    player.configure(enabled, true);
    await player.unlock();
    await settle();
    const context = required(FakeContext.instances[0]);
    player.track('music', 'music', 'round:1', 0, true);
    await settle();
    const previous = required(context.sources[0]);
    player.track('music', 'musicExplorer', 'round:2', 0, true);
    await settle();
    expect(previous.stopped).toBe(false);
    expect(context.sources).toHaveLength(1);
    if (outcome === 'muted') player.configure({ effects: true, music: false }, true);
    if (outcome === 'failed') pending.reject(new Error('Next track unavailable'));
    else pending.resolve(response());
    await settle();
    expect(previous.stopped).toBe(outcome !== 'failed');
    expect(context.sources).toHaveLength(outcome === 'ready' ? 2 : 1);
    player.destroy();
    expect(previous.stopped).toBe(true);
  });
}
