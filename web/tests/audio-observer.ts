import type { Page } from '@playwright/test';

export interface AudioTrace {
  decoded: string[];
  starts: { id: number; url: string; offset: number; loop: boolean }[];
  live: Record<number, string>;
  errors: string[];
}

declare global {
  interface Window {
    audioTrace: AudioTrace;
  }
}

export async function observeAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const trace: AudioTrace = { decoded: [], starts: [], live: {}, errors: [] };
    window.audioTrace = trace;
    window.addEventListener('unhandledrejection', (event) =>
      trace.errors.push(String(event.reason)),
    );
    const urls = new WeakMap<ArrayBuffer, string>();
    const buffers = new WeakMap<AudioBuffer, string>();
    /* Capture native methods before instrumenting their prototypes. */
    /* eslint-disable @typescript-eslint/unbound-method */
    const responseBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () {
      const buffer = await responseBuffer.call(this);
      urls.set(buffer, this.url);
      return buffer;
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (data, success, failure) {
      const url = urls.get(data) ?? '';
      return decode.call(this, data, success, failure).then((buffer) => {
        buffers.set(buffer, url);
        trace.decoded.push(url);
        return buffer;
      });
    };
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    /* eslint-enable @typescript-eslint/unbound-method */
    const ids = new WeakMap<AudioBufferSourceNode, number>();
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      const id = trace.starts.length + 1;
      const url = this.buffer ? (buffers.get(this.buffer) ?? '') : '';
      start.call(this, when, offset, duration);
      ids.set(this, id);
      trace.starts.push({ id, url, offset: offset ?? 0, loop: this.loop });
      trace.live[id] = url;
      this.addEventListener('ended', () => {
        Reflect.deleteProperty(trace.live, id);
      });
    };
    AudioBufferSourceNode.prototype.stop = function (when) {
      stop.call(this, when);
      const id = ids.get(this);
      if (id) Reflect.deleteProperty(trace.live, id);
    };
  });
}

export async function trace(page: Page): Promise<AudioTrace> {
  return page.evaluate(() => window.audioTrace);
}
