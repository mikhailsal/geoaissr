import {
  AUDIO,
  audioUrl,
  type AudioOutput,
  type AudioPreferences,
  type SoundId,
} from './audio-catalog';

interface Playing {
  id: SoundId;
  key: string;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
}

/** Owns native sources; invalidated loads never get permission to start later. */
export class AudioPlayer implements AudioOutput {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<SoundId, Promise<AudioBuffer>>();
  private readonly playing = new Map<string, Playing>();
  private readonly abort = new AbortController();
  private preferences: AudioPreferences = { effects: true, music: true };
  private active = false;
  private destroyed = false;

  async unlock(): Promise<void> {
    if (this.destroyed || typeof AudioContext === 'undefined') return;
    try {
      this.context ??= new AudioContext({ sampleRate: 44_100 });
      await this.context.resume();
      for (const id of Object.keys(AUDIO) as SoundId[]) {
        if (this.allowed(id)) void this.load(id).catch(() => undefined);
      }
    } catch {
      // Audio is optional when a browser blocks playback or has no output device.
    }
  }

  configure(preferences: AudioPreferences, active: boolean): void {
    this.preferences = preferences;
    this.active = active && !this.destroyed;
    for (const [channel, playing] of this.playing) {
      if (!this.allowed(playing.id)) this.stop(channel);
    }
  }

  cue(id: SoundId): void {
    this.start(`cue:${id}`, id, '', 0, false, false);
  }

  track(channel: string, id: SoundId, key: string, offset: number, loop = false): void {
    if (this.playing.get(channel)?.key === key) return;
    this.start(channel, id, key, offset, loop, true);
  }

  stop(channel: string): void {
    const playing = this.playing.get(channel);
    this.playing.delete(channel);
    playing?.source?.stop();
    playing?.source?.disconnect();
    playing?.gain?.disconnect();
  }

  stopAll(): void {
    for (const channel of this.playing.keys()) this.stop(channel);
  }

  destroy(): void {
    this.destroyed = true;
    this.stopAll();
    this.abort.abort();
    this.buffers.clear();
    void this.context?.close().catch(() => undefined);
  }

  private allowed(id: SoundId): boolean {
    return this.active && (id === 'music' ? this.preferences.music : this.preferences.effects);
  }

  private load(id: SoundId): Promise<AudioBuffer> {
    const cached = this.buffers.get(id);
    if (cached) return cached;
    const context = this.context;
    if (!context) return Promise.reject(new Error('Audio has not been activated'));
    const promise = fetch(audioUrl(id), { signal: this.abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
        return context.decodeAudioData(await response.arrayBuffer());
      })
      .catch((error: unknown) => {
        this.buffers.delete(id);
        throw error;
      });
    this.buffers.set(id, promise);
    return promise;
  }

  private start(
    channel: string,
    id: SoundId,
    key: string,
    offset: number,
    loop: boolean,
    synchronized: boolean,
  ): void {
    this.stop(channel);
    if (!this.allowed(id) || this.context?.state !== 'running') return;
    const playing: Playing = { id, key };
    this.playing.set(channel, playing);
    const requestedAt = performance.now();
    void this.load(id)
      .then((buffer) => {
        const elapsed = (performance.now() - requestedAt) / 1000;
        if (!synchronized && elapsed > 1) return;
        this.connectSource(channel, playing, buffer, offset + (synchronized ? elapsed : 0), loop);
      })
      .catch(() => {
        if (this.playing.get(channel) === playing) this.stop(channel);
      });
  }

  private connectSource(
    channel: string,
    playing: Playing,
    buffer: AudioBuffer,
    offset: number,
    loop: boolean,
  ): void {
    const context = this.context;
    if (this.playing.get(channel) !== playing || !this.allowed(playing.id)) return;
    if (context?.state !== 'running' || (!loop && offset >= buffer.duration)) {
      this.stop(channel);
      return;
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = AUDIO[playing.id][1];
    source.connect(gain).connect(context.destination);
    playing.source = source;
    playing.gain = gain;
    source.onended = () => {
      if (this.playing.get(channel) === playing) this.stop(channel);
    };
    source.start(0, loop ? offset % buffer.duration : Math.max(0, offset));
  }
}
