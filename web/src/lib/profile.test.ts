import { afterEach, expect, test } from 'bun:test';
import { getOrCreateProfileId, loadSavedProfile, saveProfile, clearProfile } from './profile';

const previousWindow = globalThis.window;
afterEach(() => {
  clearProfile();
  globalThis.window = previousWindow;
});

function storageWindow(initial?: string): Map<string, string> {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set('geoaissr:profile:https://example.test', initial);
  globalThis.window = {
    location: { origin: 'https://example.test' },
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => {
        data.delete(key);
      },
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    },
  } as unknown as Window & typeof globalThis;
  return data;
}

// protects: stable identity and profile round trip; fails_when: saved values or origin key change;
// no_claim: server accepts the profile.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('saves a profile under its origin and reuses its UUID', () => {
  const data = storageWindow();
  const profile = { profileId: getOrCreateProfileId(), nick: 'Оля', color: 'p-2' as const };
  saveProfile(profile);
  expect(JSON.parse(data.get('geoaissr:profile:https://example.test') ?? 'null')).toEqual(profile);
  expect(loadSavedProfile()).toEqual(profile);
  expect(getOrCreateProfileId()).toBe(profile.profileId);
});

// protects: malformed browser data does not cause an autojoin; fails_when: invalid records are used;
// no_claim: profile name and color are unique in a room.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('ignores malformed and invalid profiles', () => {
  for (const raw of [
    '{',
    'null',
    '{"version":2,"profileId":"bad","profileToken":"bad","nick":"A","color":"p-1"}',
    '{"profileId":"c71166bf-f225-4f87-a1be-505a6c3465e9","nick":"A","color":"bad"}',
  ]) {
    storageWindow(raw);
    expect(loadSavedProfile()).toBeNull();
  }
});

// protects: restricted browser storage does not block play; fails_when: reads or writes throw;
// no_claim: data persists when storage is unavailable.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('handles inaccessible storage', () => {
  globalThis.window = {
    location: { origin: 'https://example.test' },
    get localStorage(): Storage {
      throw new Error('blocked');
    },
  } as unknown as Window & typeof globalThis;
  expect(loadSavedProfile()).toBeNull();
  expect(() => {
    saveProfile({ profileId: getOrCreateProfileId(), nick: 'A', color: 'p-1' });
  }).not.toThrow();
});

// U5 protects: legacy opaque IDs, versioned credentials, unavailable storage and logout clearing;
// fails_when: valid code is lost in memory, malformed cache authenticates or logout leaves credentials;
// no_claim: isolated functions/temporary files; not real browser, tunnel or hosted model behavior.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('migrates opaque legacy identity and preserves page-session credentials until logout', () => {
  storageWindow('{"profileId":"opaque legacy ID","nick":"A","color":"p-1"}');
  expect(loadSavedProfile()?.profileId).toBe('opaque legacy ID');
  const profile = {
    version: 2 as const,
    profileId: 'opaque legacy ID',
    profileToken: 'a'.repeat(32),
    nick: 'A',
    color: 'p-1' as const,
  };
  saveProfile(profile);
  expect(loadSavedProfile()).toEqual(profile);
  globalThis.window = {
    location: { origin: 'https://example.test' },
    get localStorage(): Storage {
      throw new Error('blocked');
    },
  } as unknown as Window & typeof globalThis;
  expect(loadSavedProfile()).toEqual(profile);
  clearProfile();
  expect(loadSavedProfile()).toBeNull();
  saveProfile(profile);
  expect(loadSavedProfile()).toEqual(profile);
  clearProfile();
  expect(loadSavedProfile()).toBeNull();
});
