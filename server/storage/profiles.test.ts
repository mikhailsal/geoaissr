import { expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { starterAvatar } from '../../shared/avatar-starter.ts';
import { normalizeProfileToken, formatProfileToken } from '../../shared/profile-token.ts';
import { clientMessageSchema } from '../../shared/protocol.ts';
import { profilesFileSchema } from '../../shared/storage-schemas.ts';
import { ProfileStore, PROFILE_STORE_ERROR } from './profiles.ts';

const token = '0123456789abcdef0123456789abcdef';

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}
// U1 protects: bounded canonical parsing and formatted/case-insensitive paste;
// fails_when: invalid inputs pass or equivalent valid forms differ;
// no_claim: isolated functions/temporary files; not real browser, tunnel or hosted model behavior.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('normalizes bounded canonical, display and pasted profile codes', () => {
  expect(normalizeProfileToken(token)).toBe(token);
  expect(normalizeProfileToken(` \n${formatProfileToken(token).toUpperCase()}\t`)).toBe(token);
  expect(formatProfileToken(token).split('-')).toHaveLength(8);
  for (const raw of ['', token.slice(1), token + '0', 'z'.repeat(32), ' '.repeat(33) + token])
    expect(normalizeProfileToken(raw)).toBeNull();
});

// U2 protects: reload preserves IDs/codes/roles and equal display values;
// fails_when: reload changes identity, loses records or rejects duplicates;
// no_claim: isolated functions/temporary files; not real browser, tunnel or hosted model behavior.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('persists roles and codes, allows equal display values and registers secrets before publication', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-reload-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const secrets: string[] = [];
    const store = new ProfileStore(file, (values) => {
      secrets.push(...values);
    });
    const host = await store.create({
      profileId: 'opaque legacy ID',
      nick: 'Same',
      color: 'p-1',
      role: 'host',
    });
    const guest = await store.create({ nick: 'Same', color: 'p-1', role: 'guest' });
    expect(secrets).toContain(host.profileToken);
    expect(secrets).toContain(guest.profileToken);
    const loaded = new ProfileStore(file);
    expect(loaded.getByToken(formatProfileToken(host.profileToken))).toEqual(host);
    expect(loaded.getById(guest.profileId)).toEqual(guest);
    expect(await rejected(loaded.create({ ...guest }))).toBeInstanceOf(Error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// U3 protects: missing versus invalid/newer/unreadable registry handling;
// fails_when: bad/newer bytes are overwritten or treated as fresh;
// no_claim: isolated functions/temporary files; not real browser, tunnel or hosted model behavior.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('preserves malformed, newer, duplicate and unreadable stores', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-bad-'));
  try {
    const file = path.join(dir, 'profiles.json');
    expect(new ProfileStore(file).isAvailable()).toBe(true);
    const profile = {
      profileId: 'p',
      profileToken: token,
      nick: 'Name',
      color: 'p-1',
      role: 'host',
    };
    for (const bytes of [
      '{bad',
      JSON.stringify({ version: 2, profiles: [] }),
      JSON.stringify({ version: 1, profiles: [profile, profile] }),
      JSON.stringify({ version: 1, profiles: [profile, { ...profile, profileId: 'other' }] }),
    ]) {
      writeFileSync(file, bytes);
      const reports: string[] = [];
      const store = new ProfileStore(file, undefined, (message) => {
        reports.push(message);
      });
      expect(store.isAvailable()).toBe(false);
      expect(
        await rejected(store.create({ nick: 'A', color: 'p-1', role: 'guest' })),
      ).toBeInstanceOf(Error);
      expect(readFileSync(file, 'utf8')).toBe(bytes);
      expect(reports).toEqual([PROFILE_STORE_ERROR]);
    }
    rmSync(file);
    mkdirSync(file);
    expect(new ProfileStore(file).isAvailable()).toBe(false);
    expect(statSync(file).isDirectory()).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// U4 protects: atomic mutations, failure behavior and private permissions;
// fails_when: failed writes publish changes, alter previous bytes or expose readable files;
// no_claim: isolated functions/temporary files; not real browser, tunnel or hosted model behavior.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('keeps private files and rejects failed writes without publishing create or edit', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-atomic-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const store = new ProfileStore(file);
    const owner = await store.create({
      profileId: 'owner',
      nick: 'Owner',
      color: 'p-1',
      role: 'host',
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const bytes = readFileSync(file, 'utf8');
    chmodSync(file, 0o644);
    new ProfileStore(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    rmSync(file);
    mkdirSync(file);
    writeFileSync(path.join(file, 'original'), bytes);
    expect(await rejected(store.edit(owner.profileId, 'Changed', 'p-2'))).toBeInstanceOf(Error);
    expect(store.getById(owner.profileId)).toEqual(owner);
    expect(
      await rejected(store.create({ profileId: 'new', nick: 'N', color: 'p-2', role: 'guest' })),
    ).toBeInstanceOf(Error);
    expect(store.getById('new')).toBeUndefined();
    expect(readFileSync(path.join(file, 'original'), 'utf8')).toBe(bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// U8 protects: authentication schemas reject malformed/oversized and authority fields;
// fails_when: invalid wire input or claimed roles reaches authenticated actions;
// no_claim: isolated functions/temporary files; not real browser, tunnel or hosted model behavior.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('authentication schemas reject oversized or forged login messages and duplicate registry identity', () => {
  expect(
    clientMessageSchema.safeParse({ type: 'profile_login', profileToken: token }).success,
  ).toBe(true);
  for (const value of [null, 123, 'x'.repeat(65)])
    expect(
      clientMessageSchema.safeParse({ type: 'profile_login', profileToken: value }).success,
    ).toBe(false);
  for (const extra of [
    { role: 'host' },
    { profileId: 'p' },
    { nick: 'A' },
    { color: 'p-1' },
    { playerId: 'seat' },
  ])
    expect(
      clientMessageSchema.safeParse({ type: 'profile_login', profileToken: token, ...extra })
        .success,
    ).toBe(false);
  expect(profilesFileSchema.safeParse({ version: 2, profiles: [] }).success).toBe(false);
});

test('legacy profiles receive their stable starter and new profiles persist it on enrollment', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-avatar-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const legacy = { profileId: 'A', profileToken: token, nick: 'A', color: 'p-1', role: 'guest' };
    writeFileSync(file, JSON.stringify({ version: 1, profiles: [legacy] }));
    const store = new ProfileStore(file);
    expect(store.getByToken(token)?.avatar).toEqual(starterAvatar('A'));
    const fresh = await store.create({ profileId: 'B', nick: 'B', color: 'p-2', role: 'guest' });
    expect(fresh.avatar).toEqual(starterAvatar('B'));
    expect(fresh.avatar).not.toEqual(store.getByToken(token)?.avatar);
    const saved = profilesFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(saved.profiles.map((p) => p.avatar)).toEqual([starterAvatar('A'), starterAvatar('B')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Protects private preference durability and legacy profile compatibility; no external services.
test('audio preferences survive registry reload and code lookup without changing identity or other profiles', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-audio-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const store = new ProfileStore(file);
    const owner = await store.create({ nick: 'Owner', color: 'p-2', role: 'guest' });
    const other = await store.create({ nick: 'Other', color: 'p-3', role: 'host' });
    expect(owner.audioPreferences).toBeUndefined();
    const preferences = { effects: false, music: true, effectsVolume: 0.3, musicVolume: 0.6 };
    const saved = await store.editAudioPreferences(owner.profileId, preferences);
    expect(saved).toEqual({ ...owner, audioPreferences: preferences });
    expect(Object.isFrozen(saved.audioPreferences)).toBe(true);
    const loaded = new ProfileStore(file);
    expect(loaded.getByToken(formatProfileToken(owner.profileToken))).toEqual(saved);
    expect(loaded.getById(other.profileId)).toEqual(other);
    expect((await loaded.edit(owner.profileId, 'Renamed', 'p-4')).audioPreferences).toEqual(
      preferences,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audio preference updates validate finite bounded volumes and reject client authority fields', () => {
  const preferences = { effects: true, music: true, effectsVolume: 1, musicVolume: 0.6 };
  const message = { type: 'update_audio_preferences', seq: 2, preferences };
  expect(clientMessageSchema.safeParse(message).success).toBe(true);
  for (const level of [-0.01, 1.01, NaN, Infinity, '0.5', null]) {
    for (const key of ['effectsVolume', 'musicVolume'])
      expect(
        clientMessageSchema.safeParse({ ...message, preferences: { ...preferences, [key]: level } })
          .success,
      ).toBe(false);
  }
  for (const extra of [{ profileId: 'other' }, { playerId: 'other' }, { role: 'host' }])
    expect(clientMessageSchema.safeParse({ ...message, ...extra }).success).toBe(false);
  expect(
    clientMessageSchema.safeParse({ ...message, preferences: { ...preferences, extra: true } })
      .success,
  ).toBe(false);
});

test('failed audio preference writes retain published preferences and original registry bytes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-audio-failure-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const store = new ProfileStore(file);
    const owner = await store.create({ nick: 'Owner', color: 'p-1', role: 'host' });
    const before = readFileSync(file, 'utf8');
    const preferences = { effects: false, music: false, effectsVolume: 0.2, musicVolume: 0.1 };
    rmSync(file);
    mkdirSync(file);
    writeFileSync(path.join(file, 'original'), before);
    expect(await rejected(store.editAudioPreferences(owner.profileId, preferences))).toBeInstanceOf(
      Error,
    );
    expect(store.getById(owner.profileId)).toEqual(owner);
    expect(readFileSync(path.join(file, 'original'), 'utf8')).toBe(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes enrollment and edits, skips no-ops, and bounds sustained profile writes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-ordered-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const store = new ProfileStore(file);
    const owner = await store.create({ nick: 'Owner', color: 'p-1', role: 'host' });
    const unchangedAt = statSync(file).mtimeMs;
    await store.edit(owner.profileId, owner.nick, owner.color, owner.avatar);
    expect(statSync(file).mtimeMs).toBe(unchangedAt);
    const preferences = { effects: false, music: true, effectsVolume: 0.2, musicVolume: 0.6 };
    const [edited, enrolled] = await Promise.all([
      Promise.all([
        store.editAudioPreferences(owner.profileId, preferences),
        store.edit(owner.profileId, 'Renamed', 'p-2'),
      ]).then((writes) => writes[1]),
      store.create({ nick: 'Guest', color: 'p-3', role: 'guest' }),
    ]);
    expect(edited).toMatchObject({ nick: 'Renamed', color: 'p-2', audioPreferences: preferences });
    expect(new ProfileStore(file).getById(enrolled.profileId)).toEqual(enrolled);
    const limited = await store.create({ nick: 'Limited', color: 'p-4', role: 'guest' });
    for (let i = 0; i < 8; i += 1) {
      await store.editAudioPreferences(limited.profileId, {
        effects: true,
        music: true,
        effectsVolume: i / 20,
        musicVolume: 0.5,
      });
    }
    expect(
      await rejected(
        store.editAudioPreferences(limited.profileId, {
          effects: true,
          music: true,
          effectsVolume: 0.7,
          musicVolume: 0.5,
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(store.admitWrite('clock-test', 1_000)).toBe(true);
    for (let i = 1; i < 8; i += 1) expect(store.admitWrite('clock-test', 1_000)).toBe(true);
    expect(store.admitWrite('clock-test', 1_000)).toBe(false);
    expect(store.admitWrite('clock-test', 3_001)).toBe(true);
    const burstProfile = await store.create({ nick: 'Burst', color: 'p-3', role: 'guest' });
    const bursts = await Promise.allSettled(
      Array.from({ length: 9 }, (_, i) =>
        store.editAudioPreferences(burstProfile.profileId, {
          effects: true,
          music: true,
          effectsVolume: i / 20,
          musicVolume: 0.5,
        }),
      ),
    );
    expect(bursts.filter((write) => write.status === 'fulfilled')).toHaveLength(8);
    expect(bursts.filter((write) => write.status === 'rejected')).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
