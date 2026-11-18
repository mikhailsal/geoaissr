import { DEFAULT_AUDIO_PREFERENCES, type AudioPreferences } from './audio-catalog';
import { normalizeAudioPreferences } from './audio-preferences';

export interface AudioCache {
  preferences: AudioPreferences;
  owner: string | null;
  pending: boolean;
}
export type AudioSender = (preferences: AudioPreferences) => { sent: boolean; seq: number };
interface Profile {
  profileId: string;
  audioPreferences?: AudioPreferences;
}
interface Snapshot extends AudioCache {
  error: string | null;
}

/** Owns pending edits by profile; acknowledgements never restore older slider values. */
export class AudioProfileSync {
  private profileId: string | null = null;
  private sender: AudioSender | null = null;
  private flight: { seq: number; revision: number } | null = null;
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private error: string | null = null;

  constructor(
    private cache: AudioCache,
    private readonly changed: (state: Snapshot) => void,
  ) {}

  bind(profile: Profile, sender: AudioSender): void {
    const same = this.profileId === profile.profileId;
    const reconnect = this.sender === null;
    if (!same || (!this.cache.pending && profile.audioPreferences !== undefined)) {
      if (!same) this.cancel();
      const owned = this.cache.owner === profile.profileId;
      if (!(owned && this.cache.pending)) {
        const seed =
          owned || this.cache.owner === null ? this.cache.preferences : DEFAULT_AUDIO_PREFERENCES;
        this.cache = {
          preferences: normalizeAudioPreferences(profile.audioPreferences ?? seed),
          owner: profile.profileId,
          pending: profile.audioPreferences === undefined,
        };
      }
      this.profileId = profile.profileId;
      this.error = null;
      this.emit();
    }
    this.sender = sender;
    if (!same || reconnect) this.flush();
  }

  edit(preferences: AudioPreferences): void {
    this.cache = {
      preferences: { ...preferences },
      owner: this.profileId ?? this.cache.owner,
      pending: true,
    };
    this.revision++;
    this.error = null;
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush();
    }, 150);
  }

  flush(): void {
    clearTimeout(this.timer);
    if (!this.profileId || !this.sender || !this.cache.pending || this.flight) return;
    const result = this.sender({ ...this.cache.preferences });
    if (result.sent) this.flight = { seq: result.seq, revision: this.revision };
  }

  ack(ack: { seq: number; result: string; message?: string }): void {
    if (!this.flight || this.flight.seq !== ack.seq) return;
    const sentRevision = this.flight.revision;
    this.flight = null;
    if (ack.result !== 'ok') {
      this.error = 'Не удалось сохранить звук в профиле.';
      this.emit();
      return;
    }
    this.error = null;
    if (sentRevision === this.revision) this.cache.pending = false;
    this.emit();
    if (this.cache.pending) this.flush();
  }

  disconnect(): void {
    clearTimeout(this.timer);
    this.sender = null;
    this.flight = null;
  }

  clear(): void {
    this.cancel();
    this.profileId = null;
    this.sender = null;
    this.error = null;
    // Retain cache ownership so a different legacy profile cannot inherit these choices.
    this.cache.pending = false;
    this.emit();
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.flight = null;
    this.revision++;
  }

  private emit(): void {
    this.changed({ ...this.cache, preferences: { ...this.cache.preferences }, error: this.error });
  }
}
