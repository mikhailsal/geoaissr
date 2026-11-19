import type { AudioPreferences } from '../../shared/audio-preferences.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { starterAvatar } from '../../shared/avatar-starter.ts';
import { profilesFileSchema, type StoredProfile } from '../../shared/storage-schemas.ts';
import { normalizeProfileToken } from '../../shared/profile-token.ts';

export const PROFILE_STORE_ERROR = 'Profiles unavailable; inspect the private profile registry.';
/** Mutations are synchronous: validation, durable rename and index publication cannot interleave. */
export class ProfileStore {
  private byId = new Map<string, StoredProfile>();
  private byToken = new Map<string, StoredProfile>();
  private available = true;
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
  private commit(profiles: StoredProfile[]): void {
    if (!this.available) throw new Error(PROFILE_STORE_ERROR);
    const document = profilesFileSchema.parse({ version: 1, profiles });
    {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        mkdirSync(path.dirname(this.file), { recursive: true });
        writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', {
          mode: 0o600,
          flag: 'wx',
        });
        renameSync(temporary, this.file);
      } catch {
        try {
          unlinkSync(temporary);
        } catch {
          /* No temporary file was created. */
        }
        this.report(PROFILE_STORE_ERROR);
        throw new Error(PROFILE_STORE_ERROR);
      }
    }
    this.publish(document.profiles);
  }
  create(
    input: Omit<StoredProfile, 'profileId' | 'profileToken'> & { profileId?: string },
  ): StoredProfile {
    const profileId = input.profileId ?? randomUUID();
    if (this.byId.has(profileId)) throw new Error('Profile already enrolled.');
    let profileToken: string;
    do {
      profileToken = randomBytes(16).toString('hex');
    } while (this.byToken.has(profileToken));
    this.registerSecrets([profileToken]);
    const profile = {
      ...input,
      profileId,
      profileToken,
      avatar: input.avatar ?? starterAvatar(profileId),
    };
    this.commit([...this.byId.values(), profile]);
    const saved = this.byId.get(profileId);
    if (!saved) throw new Error(PROFILE_STORE_ERROR);
    return saved;
  }
  edit(
    profileId: string,
    nick: string,
    color: StoredProfile['color'],
    avatar?: StoredProfile['avatar'],
  ): StoredProfile {
    const current = this.byId.get(profileId);
    if (!current) throw new Error(PROFILE_STORE_ERROR);
    this.commit(
      [...this.byId.values()].map((p) =>
        p.profileId === profileId ? { ...p, nick, color, avatar: avatar ?? p.avatar } : p,
      ),
    );
    const saved = this.byId.get(profileId);
    if (!saved) throw new Error(PROFILE_STORE_ERROR);
    return saved;
  }
  editAudioPreferences(profileId: string, preferences: AudioPreferences): StoredProfile {
    if (!this.byId.has(profileId)) throw new Error(PROFILE_STORE_ERROR);
    this.commit(
      [...this.byId.values()].map((profile) =>
        profile.profileId === profileId ? { ...profile, audioPreferences: preferences } : profile,
      ),
    );
    const saved = this.byId.get(profileId);
    if (!saved) throw new Error(PROFILE_STORE_ERROR);
    return saved;
  }
}
