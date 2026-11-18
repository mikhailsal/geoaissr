import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AUDIO, audioUrl, MUSIC_PLAYLIST } from './audio-catalog';
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
  startsAt = 0;
  stopAt = Number.POSITIVE_INFINITY;
  stops: number[] = [];
  connect(gain: FakeGain): FakeGain {
    return gain;
  }
  disconnect(): void {}
  start(_when: number, offset: number): void {
    this.startsAt = _when;
    this.starts.push(offset);
  }
  stop(when = 0): void {
    this.stopAt = when;
    this.stops.push(when);
    if (when === 0) this.stopped = true;
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
  currentTime = 0;
  names = new WeakMap<AudioBuffer, string>();
  decode: () => Promise<AudioBuffer> = () => Promise.resolve({ duration: 10 } as AudioBuffer);
  constructor() {
    FakeContext.instances.push(this);
  }
  async resume(): Promise<void> {}
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    const buffer = await this.decode();
    this.names.set(buffer, new TextDecoder().decode(data));
    return buffer;
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
  advance(seconds: number, notify = true): void {
    this.currentTime = seconds;
    if (!notify) return;
    for (const source of this.sources) {
      if (!source.stopped && source.stopAt <= seconds) {
        source.stopped = true;
        source.onended?.();
      }
    }
  }
}

const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
const originalFetch = globalThis.fetch;
const enabled = { effects: true, music: true };
function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
const response = (body: string | Uint8Array<ArrayBuffer> = new Uint8Array([1])): Response =>
  new Response(body);
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
  globalThis.fetch = Object.assign(
    (input: string | URL | Request) => Promise.resolve(response(requestUrl(input))),
    {
      preconnect: originalFetch.preconnect,
    },
  );
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

test('cold lobby prioritizes its music over effects and leaves other music on demand', async () => {
  const pending = deferred<Response>();
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = requestUrl(input);
    requests.push(url);
    return url === audioUrl('music') ? pending.promise : response(url);
  }) as typeof fetch;
  const player = new AudioPlayer();
  try {
    player.configure(enabled, true);
    await player.unlock();
    player.music('lobby:match', true);
    await settle();
    expect(requests).toEqual([audioUrl('music')]);
    pending.resolve(response(audioUrl('music')));
    await settle();
    const context = required(FakeContext.instances[0]);
    expect(sourceName(context, required(context.sources[0]))).toBe(audioUrl('music'));
    expect(requests).toHaveLength(13);
    expect(requests.filter((url) => url.includes('/round-loop-'))).toEqual([audioUrl('music')]);
    player.music('game:match');
    await settle();
    expect(requests.filter((url) => url.includes('/round-loop-'))).toEqual([
      audioUrl('music'),
      audioUrl('musicExplorer'),
    ]);
  } finally {
    player.destroy();
  }
});

test('effects preload without waiting for music when background music is disabled', async () => {
  const requests: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = requestUrl(input);
    requests.push(url);
    return Promise.resolve(response(url));
  }) as typeof fetch;
  const player = new AudioPlayer();
  try {
    player.configure({ effects: true, music: false }, true);
    await player.unlock();
    await settle();
    expect(requests).toHaveLength(12);
    expect(requests.some((url) => url.includes('/round-loop-'))).toBe(false);
  } finally {
    player.destroy();
  }
});

test('a stalled music fetch cannot indefinitely prevent effects from warming', async () => {
  const pending = deferred<Response>();
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = requestUrl(input);
    requests.push(url);
    return url === audioUrl('music') ? pending.promise : response(url);
  }) as typeof fetch;
  const player = new AudioPlayer();
  try {
    player.configure(enabled, true);
    await player.unlock();
    expect(requests).toEqual([audioUrl('music')]);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(requests).toHaveLength(13);
    player.cue('click');
    await settle();
    const context = required(FakeContext.instances[0]);
    expect(sourceName(context, required(context.sources[0]))).toBe(audioUrl('click'));
  } finally {
    player.destroy();
  }
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

test('all seven variants use the independent music preference', async () => {
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  await settle();
  const context = required(FakeContext.instances[0]);
  for (const id of MUSIC_PLAYLIST) player.track(id, id, id, 0, true);
  player.cue('click');
  await settle();
  expect(context.sources).toHaveLength(8);
  const music = context.sources.filter((source) => source.loop);
  const click = required(context.sources.find((source) => !source.loop));
  expect(music).toHaveLength(7);
  player.configure({ effects: false, music: true }, true);
  expect(music.every((source) => !source.stopped)).toBe(true);
  expect(click.stopped).toBe(true);
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

function sourceName(context: FakeContext, source: FakeSource): string {
  if (!source.buffer) throw new Error('Source has no decoded buffer');
  return context.names.get(source.buffer) ?? '';
}

test('music schedules all seven complete tracks in order, wraps, and ignores repeated requests', async () => {
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  await settle();
  const context = required(FakeContext.instances[0]);
  player.music('game:match');
  await settle();
  for (let index = 0; index < 8; index++) {
    const current = required(context.sources[index]);
    const next = required(context.sources[index + 1]);
    expect(sourceName(context, current)).toBe(audioUrl(required(MUSIC_PLAYLIST[index % 7])));
    expect(current.loop).toBe(true);
    expect(next.startsAt).toBeCloseTo(current.startsAt + 10);
    expect(current.stopAt).toBe(next.startsAt);
    player.music('game:match');
    expect(context.sources).toHaveLength(index + 2);
    context.advance(next.startsAt);
    await settle();
  }
  player.destroy();
});

test('lobby loops only quiet original Suspense and a new match starts the first playlist track', async () => {
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  await settle();
  const context = required(FakeContext.instances[0]);
  player.music('lobby:match', true);
  await settle();
  expect(context.sources).toHaveLength(1);
  expect(sourceName(context, required(context.sources[0]))).toBe(audioUrl('music'));
  expect(required(context.gains[0]).gain.value).toBeCloseTo(AUDIO.music[1] * 0.65);
  context.advance(50);
  player.music('lobby:match', true);
  expect(context.sources).toHaveLength(1);
  player.music('game:match');
  await settle();
  expect(required(context.sources[0]).stopped).toBe(true);
  expect(sourceName(context, required(context.sources[1]))).toBe(audioUrl('music'));
  expect(required(context.sources[1]).starts).toEqual([0]);
  player.stop('music');
  player.music('lobby:match', true);
  await settle();
  expect(sourceName(context, required(context.sources.at(-1)))).toBe(audioUrl('music'));
  player.destroy();
});

for (const pause of ['mute', 'inactive', 'stopAll'] as const) {
  test(`music ${pause} cancels future nodes and resumes the first saved playhead`, async () => {
    const player = new AudioPlayer();
    player.configure(enabled, true);
    await player.unlock();
    await settle();
    const context = required(FakeContext.instances[0]);
    player.music('game:match');
    await settle();
    const current = required(context.sources[0]);
    const next = required(context.sources[1]);
    context.advance(current.startsAt + 3);
    if (pause === 'mute') player.configure({ effects: true, music: false }, true);
    if (pause === 'inactive') player.configure(enabled, false);
    if (pause === 'stopAll') player.stopAll();
    expect(current.stopped).toBe(true);
    expect(next.stopped).toBe(true);
    context.advance(100, false);
    player.stopAll();
    current.onended?.();
    await settle();
    expect(context.sources).toHaveLength(2);
    player.configure(enabled, true);
    player.music('game:match');
    await settle();
    const resumed = required(context.sources[2]);
    expect(sourceName(context, resumed)).toBe(audioUrl('music'));
    expect(resumed.starts[0]).toBeCloseTo(3);
    expect(required(context.sources[3]).startsAt - resumed.startsAt).toBeCloseTo(7);
    player.destroy();
  });
}

test('pausing after a scheduled handoff uses the audible successor before its callback runs', async () => {
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  await settle();
  const context = required(FakeContext.instances[0]);
  player.music('game:match');
  await settle();
  const old = required(context.sources[0]);
  const successor = required(context.sources[1]);
  context.advance(successor.startsAt + 2, false);
  player.stopAll();
  old.onended?.();
  context.advance(100, false);
  player.music('game:match');
  await settle();
  const resumed = required(context.sources[2]);
  expect(sourceName(context, resumed)).toBe(audioUrl('musicExplorer'));
  expect(resumed.starts[0]).toBeCloseTo(2);
  expect(required(context.sources[3]).startsAt - resumed.startsAt).toBeCloseTo(8);
  player.destroy();
});

test('a pending old playlist cannot replace the lobby after its fetch finishes', async () => {
  const pending = deferred<Response>();
  globalThis.fetch = (async (url: string | URL | Request) =>
    requestUrl(url) === audioUrl('music')
      ? pending.promise
      : response(requestUrl(url))) as typeof fetch;
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  await settle();
  const context = required(FakeContext.instances[0]);
  player.music('old-game');
  player.music('lobby', true);
  await settle();
  pending.resolve(response(audioUrl('music')));
  await settle();
  expect(context.sources).toHaveLength(1);
  expect(sourceName(context, required(context.sources[0]))).toBe(audioUrl('music'));
  player.destroy();
});

for (const readyAt of [10.05, 12]) {
  test(`a successor decoded at ${readyAt}s waits for a complete fallback loop`, async () => {
    const pending = deferred<Response>();
    globalThis.fetch = (async (url: string | URL | Request) =>
      requestUrl(url) === audioUrl('musicExplorer')
        ? pending.promise
        : response(requestUrl(url))) as typeof fetch;
    const player = new AudioPlayer();
    player.configure(enabled, true);
    await player.unlock();
    await settle();
    const context = required(FakeContext.instances[0]);
    player.music('game:match');
    await settle();
    const current = required(context.sources[0]);
    expect(current.stopAt).toBe(Number.POSITIVE_INFINITY);
    context.advance(readyAt, false);
    pending.resolve(response(audioUrl('musicExplorer')));
    await settle();
    expect(current.stopped).toBe(false);
    expect(current.stopAt).toBeCloseTo(20.05);
    expect(required(context.sources[1]).startsAt).toBe(current.stopAt);
    player.destroy();
  });
}

test('an unavailable successor leaves current music playing and retries before the handoff', async () => {
  const pending = deferred<Response>();
  let attempts = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (requestUrl(url) === audioUrl('musicExplorer') && ++attempts === 1) return pending.promise;
    return response(requestUrl(url));
  }) as typeof fetch;
  const player = new AudioPlayer();
  player.configure(enabled, true);
  await player.unlock();
  await settle();
  const context = required(FakeContext.instances[0]);
  player.music('game:match');
  await settle();
  const current = required(context.sources[0]);
  pending.reject(new Error('Temporary asset failure'));
  await settle();
  expect(context.sources).toHaveLength(1);
  expect(current.stopped).toBe(false);
  expect(current.stopAt).toBe(Number.POSITIVE_INFINITY);
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  await settle();
  expect(attempts).toBe(2);
  expect(context.sources).toHaveLength(2);
  expect(current.stopped).toBe(false);
  expect(current.stopAt).toBe(required(context.sources[1]).startsAt);
  player.destroy();
});
