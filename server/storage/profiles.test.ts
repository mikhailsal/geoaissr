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
test('persists roles and codes, allows equal display values and registers secrets before publication', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-reload-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const secrets: string[] = [];
    const store = new ProfileStore(file, (values) => {
      secrets.push(...values);
    });
    const host = store.create({
      profileId: 'opaque legacy ID',
      nick: 'Same',
      color: 'p-1',
      role: 'host',
    });
    const guest = store.create({ nick: 'Same', color: 'p-1', role: 'guest' });
    expect(secrets).toContain(host.profileToken);
    expect(secrets).toContain(guest.profileToken);
    const loaded = new ProfileStore(file);
    expect(loaded.getByToken(formatProfileToken(host.profileToken))).toEqual(host);
    expect(loaded.getById(guest.profileId)).toEqual(guest);
    expect(() => {
      loaded.create({ ...guest });
    }).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// U3 protects: missing versus invalid/newer/unreadable registry handling;
// fails_when: bad/newer bytes are overwritten or treated as fresh;
// no_claim: isolated functions/temporary files; not real browser, tunnel or hosted model behavior.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('preserves malformed, newer, duplicate and unreadable stores', () => {
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
      expect(() => {
        store.create({ nick: 'A', color: 'p-1', role: 'guest' });
      }).toThrow();
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
test('keeps private files and rejects failed writes without publishing create or edit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-atomic-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const store = new ProfileStore(file);
    const owner = store.create({ profileId: 'owner', nick: 'Owner', color: 'p-1', role: 'host' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const bytes = readFileSync(file, 'utf8');
    chmodSync(file, 0o644);
    new ProfileStore(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    rmSync(file);
    mkdirSync(file);
    writeFileSync(path.join(file, 'original'), bytes);
    expect(() => {
      store.edit(owner.profileId, 'Changed', 'p-2');
    }).toThrow();
    expect(store.getById(owner.profileId)).toEqual(owner);
    expect(() => {
      store.create({ profileId: 'new', nick: 'N', color: 'p-2', role: 'guest' });
    }).toThrow();
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

test('legacy profiles receive their stable starter and new profiles persist it on enrollment', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profiles-avatar-'));
  try {
    const file = path.join(dir, 'profiles.json');
    const legacy = { profileId: 'A', profileToken: token, nick: 'A', color: 'p-1', role: 'guest' };
    writeFileSync(file, JSON.stringify({ version: 1, profiles: [legacy] }));
    const store = new ProfileStore(file);
    expect(store.getByToken(token)?.avatar).toEqual(starterAvatar('A'));
    const fresh = store.create({ profileId: 'B', nick: 'B', color: 'p-2', role: 'guest' });
    expect(fresh.avatar).toEqual(starterAvatar('B'));
    expect(fresh.avatar).not.toEqual(store.getByToken(token)?.avatar);
    const saved = profilesFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(saved.profiles.map((p) => p.avatar)).toEqual([starterAvatar('A'), starterAvatar('B')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
