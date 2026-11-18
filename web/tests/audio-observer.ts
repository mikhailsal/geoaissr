import type { Page } from '@playwright/test';

export interface AudioStart {
  id: number;
  url: string;
  offset: number;
  loop: boolean;
  at: number;
  duration: number;
  gain: number | undefined;
}

interface DecodeTrace {
  decoded: string[];
  errors: string[];
  resumedOn: string[];
}

interface SourceTrace {
  now: number;
  starts: AudioStart[];
  ended: Record<number, number>;
  stops: { id: number; at: number; when: number }[];
  live: Record<number, string>;
}

export type AudioTrace = DecodeTrace & SourceTrace;

declare global {
  interface Window {
    audioDecodeTrace: DecodeTrace;
    audioBufferUrls: WeakMap<AudioBuffer, string>;
    audioSourceTrace: () => SourceTrace;
  }
}

export async function observeAudio(
  page: Page,
  options: { musicSeconds?: number } = {},
): Promise<void> {
  await page.addInitScript(installDecodeObserver, options.musicSeconds);
  await page.addInitScript(installSourceObserver);
}

function installDecodeObserver(musicSeconds: number | undefined): void {
  const trace: DecodeTrace = { decoded: [], errors: [], resumedOn: [] };
  const urls = new WeakMap<ArrayBuffer, string>();
  const buffers = new WeakMap<AudioBuffer, string>();
  window.audioDecodeTrace = trace;
  window.audioBufferUrls = buffers;
  window.addEventListener('unhandledrejection', (event) => trace.errors.push(String(event.reason)));
  let inputEvent = 'none';
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    document.addEventListener(
      type,
      () => {
        inputEvent = type;
      },
      { capture: true },
    );
  }
  /* Capture native methods before instrumenting their prototypes. */
  /* eslint-disable @typescript-eslint/unbound-method */
  const resume = AudioContext.prototype.resume;
  const responseBuffer = Response.prototype.arrayBuffer;
  const decode = AudioContext.prototype.decodeAudioData;
  /* eslint-enable @typescript-eslint/unbound-method */
  AudioContext.prototype.resume = function () {
    trace.resumedOn.push(inputEvent);
    return resume.call(this);
  };
  Response.prototype.arrayBuffer = async function () {
    const buffer = await responseBuffer.call(this);
    urls.set(buffer, this.url);
    return buffer;
  };
  AudioContext.prototype.decodeAudioData = function (data, success, failure) {
    const url = urls.get(data) ?? '';
    return decode.call(this, data, success, failure).then((buffer) => {
      let playbackBuffer = buffer;
      if (musicSeconds !== undefined && url.includes('/round-loop-')) {
        const length = Math.min(buffer.length, Math.round(musicSeconds * buffer.sampleRate));
        playbackBuffer = this.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          playbackBuffer
            .getChannelData(channel)
            .set(buffer.getChannelData(channel).subarray(0, length));
        }
      }
      buffers.set(playbackBuffer, url);
      trace.decoded.push(url);
      return playbackBuffer;
    });
  };
}

function installSourceObserver(): void {
  const starts: AudioStart[] = [];
  const ended: SourceTrace['ended'] = {};
  const stops: SourceTrace['stops'] = [];
  const lastStop = new Map<number, number>();
  const ids = new WeakMap<AudioBufferSourceNode, number>();
  const gains = new WeakMap<AudioBufferSourceNode, GainNode>();
  let context: BaseAudioContext | undefined;
  window.audioSourceTrace = () => {
    const now = context?.currentTime ?? 0;
    const live: SourceTrace['live'] = {};
    for (const source of starts) {
      const scheduledStop = lastStop.get(source.id) ?? Infinity;
      if (source.at <= now && !(source.id in ended) && now < scheduledStop) {
        live[source.id] = source.url;
      }
    }
    return { now, starts, ended, stops, live };
  };
  /* eslint-disable @typescript-eslint/unbound-method */
  const start = AudioBufferSourceNode.prototype.start;
  const stop = AudioBufferSourceNode.prototype.stop;
  const connect = AudioBufferSourceNode.prototype.connect;
  /* eslint-enable @typescript-eslint/unbound-method */
  AudioBufferSourceNode.prototype.connect = new Proxy(connect, {
    apply(target, source: AudioBufferSourceNode, args: unknown[]) {
      const [destination] = args;
      if (destination instanceof GainNode) gains.set(source, destination);
      return Reflect.apply(target, source, args) as AudioNode | undefined;
    },
  });
  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    const id = starts.length + 1;
    const url = this.buffer ? (window.audioBufferUrls.get(this.buffer) ?? '') : '';
    const at = Math.max(when ?? 0, this.context.currentTime);
    start.call(this, when, offset, duration);
    context = this.context;
    ids.set(this, id);
    starts.push({
      id,
      url,
      offset: offset ?? 0,
      loop: this.loop,
      at,
      duration: this.buffer?.duration ?? 0,
      gain: gains.get(this)?.gain.value,
    });
    this.addEventListener('ended', () => {
      ended[id] = this.context.currentTime;
    });
  };
  AudioBufferSourceNode.prototype.stop = function (when) {
    stop.call(this, when);
    const id = ids.get(this);
    if (id === undefined) return;
    const at = this.context.currentTime;
    const effectiveStop = Math.max(when ?? 0, at);
    lastStop.set(id, effectiveStop);
    stops.push({ id, at, when: effectiveStop });
  };
}

export async function trace(page: Page): Promise<AudioTrace> {
  return page.evaluate(() => ({ ...window.audioDecodeTrace, ...window.audioSourceTrace() }));
}
