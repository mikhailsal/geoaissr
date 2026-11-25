import type { AudioPreferences } from '../../shared/audio-preferences.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { starterAvatar } from '../../shared/avatar-starter.ts';
import { profilesFileSchema, type StoredProfile } from '../../shared/storage-schemas.ts';
import { normalizeProfileToken } from '../../shared/profile-token.ts';

export const PROFILE_STORE_ERROR = 'Profiles unavailable; inspect the private profile registry.';
const MAX_PENDING_WRITES_PER_PROFILE = 8;
const MAX_WRITES_PER_PROFILE_WINDOW = 8;
const PROFILE_WRITE_WINDOW_MS = 2_000;

function sameAudioPreferences(
  a: AudioPreferences | undefined,
  b: AudioPreferences | undefined,
): boolean {
  return (
    a?.effects === b?.effects &&
    a?.music === b?.music &&
    a?.effectsVolume === b?.effectsVolume &&
    a?.musicVolume === b?.musicVolume
  );
}

function sameAvatar(a: StoredProfile['avatar'], b: StoredProfile['avatar']): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Serialized durable mutations publish only after their atomic replacement succeeds. */
export class ProfileStore {
  private byId = new Map<string, StoredProfile>();
  private byToken = new Map<string, StoredProfile>();
  private available = true;
  private writeTail: Promise<void> = Promise.resolve();
  private pendingWrites = new Map<string, number>();
  private writeTimes = new Map<string, number[]>();
  private reservedIds = new Set<string>();
  private reservedTokens = new Set<string>();
  constructor(
    private readonly file: string,
    private readonly registerSecrets: (tokens: string[]) => void = () => {},
    private readonly report: (message: string) => void = () => {},
  ) {
    try {
      const document = profilesFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      this.registerSecrets(document.profiles.map((p) => p.profileToken));
      chmodSync(file, 0o600);
      this.publish(
        document.profiles.map((p) => ({ ...p, avatar: p.avatar ?? starterAvatar(p.profileId) })),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.available = false;
      this.report(PROFILE_STORE_ERROR);
    }
  }
  isAvailable(): boolean {
    return this.available;
  }
  /** Admit a socket write before it joins a per-socket queue. */
  admitWrite(profileId: string, now = Date.now()): boolean {
    const times = (this.writeTimes.get(profileId) ?? []).filter(
      (time) => time > now - PROFILE_WRITE_WINDOW_MS,
    );
    if (times.length >= MAX_WRITES_PER_PROFILE_WINDOW) {
      if (times.length > 0) this.writeTimes.set(profileId, times);
      return false;
    }
    times.push(now);
    this.writeTimes.set(profileId, times);
    return true;
  }
  writeRetryAfterMs(profileId: string, now = Date.now()): number {
    const first = (this.writeTimes.get(profileId) ?? []).find(
      (time) => time > now - PROFILE_WRITE_WINDOW_MS,
    );
    return first === undefined ? 1 : Math.max(1, first + PROFILE_WRITE_WINDOW_MS - now);
  }
  flush(): Promise<void> {
    return this.writeTail;
  }
  getById(id: string): StoredProfile | undefined {
    return this.byId.get(id);
  }
  getByToken(raw: string): StoredProfile | undefined {
    const code = normalizeProfileToken(raw);
    return code ? this.byToken.get(code) : undefined;
  }
  private publish(profiles: StoredProfile[]): void {
    this.byId = new Map(
      profiles.map((p) => {
        if (p.audioPreferences) Object.freeze(p.audioPreferences);
        return [p.profileId, Object.freeze({ ...p })];
      }),
    );
    this.byToken = new Map([...this.byId.values()].map((p) => [p.profileToken, p]));
  }
  private async commit(profiles: StoredProfile[]): Promise<void> {
    if (!this.available) throw new Error(PROFILE_STORE_ERROR);
    const document = profilesFileSchema.parse({ version: 1, profiles });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(temporary, JSON.stringify(document, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, this.file);
    } catch {
      try {
        await unlink(temporary);
      } catch {
        /* No temporary file was created. */
      }
      this.report(PROFILE_STORE_ERROR);
      throw new Error(PROFILE_STORE_ERROR);
    }
    this.publish(document.profiles);
  }
  private queueWrite(
    profileId: string,
    operation: () => Promise<StoredProfile>,
  ): Promise<StoredProfile> {
    if (!this.available) return Promise.reject(new Error(PROFILE_STORE_ERROR));
    const pending = this.pendingWrites.get(profileId) ?? 0;
    if (pending >= MAX_PENDING_WRITES_PER_PROFILE)
      return Promise.reject(new Error(PROFILE_STORE_ERROR));
    this.pendingWrites.set(profileId, pending + 1);
    const write = this.writeTail.then(operation);
    this.writeTail = write.then(
      () => undefined,
      () => undefined,
    );
    return write.finally(() => {
      const remaining = (this.pendingWrites.get(profileId) ?? 1) - 1;
      if (remaining > 0) this.pendingWrites.set(profileId, remaining);
      else this.pendingWrites.delete(profileId);
    });
  }
  create(
    input: Omit<StoredProfile, 'profileId' | 'profileToken'> & { profileId?: string },
    canCommit: () => boolean = () => true,
  ): Promise<StoredProfile> {
    const profileId = input.profileId ?? randomUUID();
    if (this.byId.has(profileId) || this.reservedIds.has(profileId))
      return Promise.reject(new Error('Profile already enrolled.'));
    let profileToken: string;
    do {
      profileToken = randomBytes(16).toString('hex');
    } while (this.byToken.has(profileToken) || this.reservedTokens.has(profileToken));
    this.reservedIds.add(profileId);
    this.reservedTokens.add(profileToken);
    this.registerSecrets([profileToken]);
    const profile = {
      ...input,
      profileId,
      profileToken,
      avatar: input.avatar ?? starterAvatar(profileId),
    };
    return this.queueWrite(profileId, async () => {
      if (this.byId.has(profileId)) throw new Error('Profile already enrolled.');
      if (!canCommit()) throw new Error(PROFILE_STORE_ERROR);
      await this.commit([...this.byId.values(), profile]);
      const saved = this.byId.get(profileId);
      if (!saved) throw new Error(PROFILE_STORE_ERROR);
      return saved;
    }).finally(() => {
      this.reservedIds.delete(profileId);
      this.reservedTokens.delete(profileToken);
    });
  }
  edit(
    profileId: string,
    nick: string,
    color: StoredProfile['color'],
    avatar?: StoredProfile['avatar'],
    admitted = false,
  ): Promise<StoredProfile> {
    if (!admitted && !this.admitWrite(profileId))
      return Promise.reject(new Error(PROFILE_STORE_ERROR));
    return this.queueWrite(profileId, async () => {
      const current = this.byId.get(profileId);
      if (!current) throw new Error(PROFILE_STORE_ERROR);
      const nextAvatar = avatar ?? current.avatar;
      if (
        current.nick === nick &&
        current.color === color &&
        sameAvatar(current.avatar, nextAvatar)
      )
        return current;
      await this.commit(
        [...this.byId.values()].map((p) =>
          p.profileId === profileId ? { ...p, nick, color, avatar: nextAvatar } : p,
        ),
      );
      const saved = this.byId.get(profileId);
      if (!saved) throw new Error(PROFILE_STORE_ERROR);
      return saved;
    });
  }
  editAudioPreferences(
    profileId: string,
    preferences: AudioPreferences,
    admitted = false,
  ): Promise<StoredProfile> {
    if (!admitted && !this.admitWrite(profileId))
      return Promise.reject(new Error(PROFILE_STORE_ERROR));
    return this.queueWrite(profileId, async () => {
      const current = this.byId.get(profileId);
      if (!current) throw new Error(PROFILE_STORE_ERROR);
      if (sameAudioPreferences(current.audioPreferences, preferences)) return current;
      await this.commit(
        [...this.byId.values()].map((profile) =>
          profile.profileId === profileId ? { ...profile, audioPreferences: preferences } : profile,
        ),
      );
      const saved = this.byId.get(profileId);
      if (!saved) throw new Error(PROFILE_STORE_ERROR);
      return saved;
    });
  }
}
