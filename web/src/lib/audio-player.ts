import {
  AUDIO,
  audioUrl,
  isMusic,
  LOBBY_MUSIC,
  MUSIC_PLAYLIST,
  type AudioOutput,
  type AudioPreferences,
  type SoundId,
} from './audio-catalog';

interface Playing {
  id: SoundId;
  key: string;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  previous?: Playing;
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
  private sequence: MusicSequence | null = null;

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
    if (!this.active || !preferences.music) this.sequence?.pause();
    for (const [channel, playing] of this.playing) {
      if (!this.allowed(playing.id)) this.stop(channel);
    }
  }

  cue(id: SoundId): void {
    this.start(`cue:${id}`, id, '', 0, false, false);
  }

  music(key: string, lobby = false): void {
    const context = this.context;
    if (!this.allowed('music') || context?.state !== 'running') return;
    this.sequence ??= new MusicSequence(context, (id) => this.load(id));
    this.sequence.play(key, lobby);
  }

  track(channel: string, id: SoundId, key: string, offset: number, loop = false): void {
    if (this.playing.get(channel)?.key === key) return;
    this.start(channel, id, key, offset, loop, true);
  }

  stop(channel: string): void {
    if (channel === 'music') this.sequence?.stop();
    const playing = this.playing.get(channel);
    this.playing.delete(channel);
    if (playing) this.disconnect(playing);
  }

  private disconnect(playing: Playing): void {
    if (playing.previous) this.disconnect(playing.previous);
    playing.source?.stop();
    playing.source?.disconnect();
    playing.gain?.disconnect();
  }

  stopAll(): void {
    for (const channel of this.playing.keys()) this.stop(channel);
    this.sequence?.pause();
  }

  destroy(): void {
    this.destroyed = true;
    this.active = false;
    this.stopAll();
    this.sequence?.stop();
    this.abort.abort();
    this.buffers.clear();
    void this.context?.close().catch(() => undefined);
  }

  private allowed(id: SoundId): boolean {
    return this.active && (isMusic(id) ? this.preferences.music : this.preferences.effects);
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
    const current = this.playing.get(channel);
    const previous = loop && isMusic(id) ? (current?.previous ?? current) : undefined;
    if (!previous) this.stop(channel);
    if (!this.allowed(id) || this.context?.state !== 'running') return;
    const playing: Playing = { id, key, previous };
    this.playing.set(channel, playing);
    const requestedAt = performance.now();
    void this.load(id)
      .then((buffer) => {
        const elapsed = (performance.now() - requestedAt) / 1000;
        if (!synchronized && elapsed > 1) return;
        this.connectSource(channel, playing, buffer, offset + (synchronized ? elapsed : 0), loop);
      })
      .catch(() => {
        if (this.playing.get(channel) !== playing) return;
        if (playing.previous) this.playing.set(channel, playing.previous);
        else this.stop(channel);
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
      source.disconnect();
      gain.disconnect();
      if (this.playing.get(channel) === playing) this.playing.delete(channel);
    };
    source.start(0, loop ? offset % buffer.duration : Math.max(0, offset));
    if (playing.previous) {
      this.disconnect(playing.previous);
      playing.previous = undefined;
    }
  }
}

interface MusicSource {
  index: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  startsAt: number;
  offset: number;
  duration: number;
}

/** Schedules complete tracks on the audio clock; round transitions never move its playhead. */
class MusicSequence {
  private key: string | null = null;
  private ids: readonly SoundId[] = MUSIC_PLAYLIST;
  private scale = 1;
  private running = false;
  private generation = 0;
  private index = 0;
  private offset = 0;
  private current: MusicSource | null = null;
  private next: MusicSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly context: AudioContext,
    private readonly load: (id: SoundId) => Promise<AudioBuffer>,
  ) {}

  play(key: string, lobby: boolean): void {
    if (key !== this.key) {
      this.stop();
      this.key = key;
      this.ids = lobby ? LOBBY_MUSIC : MUSIC_PLAYLIST;
      this.scale = lobby ? 0.65 : 1;
    }
    if (this.running) return;
    this.running = true;
    this.start(++this.generation);
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.generation++;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const now = this.context.currentTime;
    const audible = this.next && now >= this.next.startsAt ? this.next : this.current;
    if (audible) {
      this.index = audible.index;
      this.offset = (audible.offset + Math.max(0, now - audible.startsAt)) % audible.duration;
    }
    for (const track of [this.current, this.next]) {
      track?.source.stop();
      track?.source.disconnect();
      track?.gain.disconnect();
    }
    this.current = null;
    this.next = null;
  }

  stop(): void {
    this.pause();
    this.key = null;
    this.index = 0;
    this.offset = 0;
  }

  private valid(token: number): boolean {
    return this.running && token === this.generation;
  }

  private id(index: number): SoundId {
    return this.ids[index] ?? 'music';
  }

  private start(token: number): void {
    void this.load(this.id(this.index))
      .then((buffer) => {
        if (!this.valid(token)) return;
        this.current = this.create(
          this.index,
          buffer,
          this.context.currentTime + 0.05,
          this.offset,
        );
        this.prepareNext(this.current, token);
      })
      .catch(() => {
        this.retry(token, () => {
          this.start(token);
        });
      });
  }

  private prepareNext(current: MusicSource, token: number): void {
    if (this.ids.length === 1) return;
    const index = (current.index + 1) % this.ids.length;
    void this.load(this.id(index))
      .then((buffer) => {
        if (!this.valid(token) || this.current !== current) return;
        const end = current.startsAt + current.duration - current.offset;
        const repeats = Math.max(
          0,
          Math.ceil((this.context.currentTime + 0.05 - end) / current.duration),
        );
        const startsAt = end + repeats * current.duration;
        const next = this.create(index, buffer, startsAt, 0);
        this.next = next;
        current.source.onended = () => {
          current.source.disconnect();
          current.gain.disconnect();
          if (!this.valid(token) || this.current !== current) return;
          this.current = next;
          this.next = null;
          this.index = index;
          this.offset = 0;
          this.prepareNext(next, token);
        };
        current.source.stop(startsAt);
      })
      .catch(() => {
        this.retry(token, () => {
          this.prepareNext(current, token);
        });
      });
  }

  private create(
    index: number,
    buffer: AudioBuffer,
    startsAt: number,
    offset: number,
  ): MusicSource {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = AUDIO[this.id(index)][1] * this.scale;
    source.connect(gain).connect(this.context.destination);
    source.start(startsAt, offset);
    return { index, source, gain, startsAt, offset, duration: buffer.duration };
  }

  private retry(token: number, action: () => void): void {
    if (!this.valid(token)) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.valid(token)) action();
    }, 2_000);
  }
}
