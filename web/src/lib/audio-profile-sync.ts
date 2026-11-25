import { DEFAULT_AUDIO_PREFERENCES, type AudioPreferences } from './audio-catalog';
import { normalizeAudioPreferences } from './audio-preferences';

export interface AudioCache {
  preferences: AudioPreferences;
  owner: string | null;
  pending: boolean;
  pendingByProfile?: Record<string, AudioPreferences>;
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
  private cache: Omit<AudioCache, 'pendingByProfile'>;
  private readonly pendingByProfile = new Map<string, AudioPreferences>();
  private profileId: string | null = null;
  private sender: AudioSender | null = null;
  private flight: { seq: number; revision: number } | null = null;
  private revision = 0;
  private retryAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private error: string | null = null;

  constructor(
    cache: AudioCache,
    private readonly changed: (state: Snapshot) => void,
  ) {
    const { pendingByProfile, ...current } = cache;
    this.cache = current;
    for (const [profileId, preferences] of Object.entries(pendingByProfile ?? {})) {
      this.pendingByProfile.set(profileId, { ...preferences });
    }
    if (pendingByProfile === undefined && current.owner !== null && current.pending) {
      this.pendingByProfile.set(current.owner, { ...current.preferences });
    }
  }

  bind(profile: Profile, sender: AudioSender): void {
    const same = this.profileId === profile.profileId;
    const reconnect = this.sender === null;
    if (!same || (!this.cache.pending && profile.audioPreferences !== undefined)) {
      if (!same) this.cancel();
      const pending = this.pendingByProfile.get(profile.profileId);
      const seed =
        this.cache.owner === profile.profileId || this.cache.owner === null
          ? this.cache.preferences
          : DEFAULT_AUDIO_PREFERENCES;
      this.cache = {
        preferences: normalizeAudioPreferences(pending ?? profile.audioPreferences ?? seed),
        owner: profile.profileId,
        pending: pending !== undefined || profile.audioPreferences === undefined,
      };
      if (this.cache.pending) this.pendingByProfile.set(profile.profileId, this.cache.preferences);
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
    if (this.cache.owner !== null) {
      this.pendingByProfile.set(this.cache.owner, this.cache.preferences);
    }
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
    const waitMs = this.retryAt - Date.now();
    if (waitMs > 0) {
      this.timer = setTimeout(() => {
        this.flush();
      }, waitMs);
      return;
    }
    const result = this.sender({ ...this.cache.preferences });
    if (result.sent) this.flight = { seq: result.seq, revision: this.revision };
  }

  ack(ack: { seq: number; result: string; retryAfterMs?: number }): void {
    if (!this.profileId || !this.flight || this.flight.seq !== ack.seq) return;
    const sentRevision = this.flight.revision;
    this.flight = null;
    if (ack.result === 'rate_limited') {
      this.retryAt = Date.now() + Math.max(1, ack.retryAfterMs ?? 2000);
      this.flush();
      return;
    }
    if (ack.result !== 'ok') {
      this.error = 'Не удалось сохранить звук в профиле.';
      this.emit();
      return;
    }
    this.error = null;
    if (sentRevision === this.revision) {
      this.cache.pending = false;
      this.pendingByProfile.delete(this.profileId);
    }
    this.emit();
    if (this.cache.pending) this.flush();
  }

  disconnect(): void {
    clearTimeout(this.timer);
    this.sender = null;
    this.flight = null;
  }

  clear(preservePending = true, savedProfileId?: string): void {
    this.cancel();
    const profileId = this.profileId ?? savedProfileId;
    if (!preservePending && profileId !== undefined) {
      this.pendingByProfile.delete(profileId);
      if (this.cache.owner === profileId && this.cache.pending) {
        this.cache = {
          preferences: { ...DEFAULT_AUDIO_PREFERENCES },
          owner: profileId,
          pending: false,
        };
      }
    }
    this.profileId = null;
    this.sender = null;
    this.error = null;
    // Edits have already been cached. Logout must never publish a stale snapshot.
  }

  private cancel(): void {
    this.retryAt = 0;
    clearTimeout(this.timer);
    this.flight = null;
    this.revision++;
  }

  private emit(): void {
    this.changed({
      ...this.cache,
      preferences: { ...this.cache.preferences },
      pendingByProfile: Object.fromEntries(
        Array.from(this.pendingByProfile, ([id, preferences]) => [id, { ...preferences }] as const),
      ),
      error: this.error,
    });
  }
}
