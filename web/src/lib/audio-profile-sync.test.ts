import { expect, test } from 'bun:test';
import { DEFAULT_AUDIO_PREFERENCES as defaults, type AudioPreferences } from './audio-catalog';
import { AudioProfileSync, type AudioCache } from './audio-profile-sync';

// Value: protects=durable audio edits remain with their authenticated profile; fails_when=server restore echoes or stale acknowledgements erase newer settings; why_new=audio was browser-only; seam=pure controller with transport recording; no_claim=does not verify real server writes or browser UI.

function harness(
  cache: AudioCache = { preferences: { ...defaults }, owner: null, pending: false },
  persist?: (cache: AudioCache) => void,
) {
  let state = { ...cache, error: null as string | null };
  const sends: { seq: number; preferences: AudioPreferences }[] = [];
  let seq = 0;
  const controller = new AudioProfileSync(cache, (snapshot) => {
    state = snapshot;
    persist?.(snapshot);
  });
  const sender = (preferences: AudioPreferences) => {
    sends.push({ seq: ++seq, preferences });
    return { sent: true, seq };
  };
  return { controller, sender, sends, state: () => state };
}

test('server preferences restore authoritatively without being echoed', () => {
  const h = harness();
  const remote = { ...defaults, musicVolume: 0.23 };
  h.controller.bind({ profileId: 'A', audioPreferences: remote }, h.sender);
  expect(h.state().preferences).toEqual(remote);
  expect(h.sends).toHaveLength(0);
  h.controller.disconnect();
  h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
  expect(h.state().preferences).toEqual(defaults);
  expect(h.sends).toHaveLength(0);
  h.controller.clear();
});

test('legacy profiles seed unowned local preferences once; different owners use defaults', () => {
  const local = { ...defaults, musicVolume: 0.25 };
  const h = harness({ preferences: local, owner: null, pending: false });
  h.controller.bind({ profileId: 'A' }, h.sender);
  expect(h.sends[0]?.preferences).toEqual(local);
  h.controller.ack({ seq: 1, result: 'ok' });
  h.controller.clear();
  h.controller.bind({ profileId: 'B' }, h.sender);
  expect(h.sends[1]?.preferences).toEqual(defaults);
  h.controller.clear();
});

test('same-profile cached pending edits win over older auth and survive reconnect', () => {
  const local = { ...defaults, musicVolume: 0.31 };
  const h = harness({ preferences: local, owner: 'A', pending: true });
  h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
  expect(h.sends[0]?.preferences).toEqual(local);
  h.controller.disconnect();
  h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
  expect(h.sends[1]?.preferences).toEqual(local);
  h.controller.ack({ seq: 1, result: 'ok' });
  expect(h.state().pending).toBe(true);
  h.controller.ack({ seq: 2, result: 'ok' });
  expect(h.state().pending).toBe(false);
  h.controller.clear();
});

test('older acknowledgements cannot replace newer local edits, which flush next', () => {
  const h = harness();
  h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
  h.controller.edit({ ...defaults, musicVolume: 0.2 });
  h.controller.flush();
  h.controller.edit({ ...defaults, musicVolume: 0.4 });
  h.controller.ack({ seq: 1, result: 'ok' });
  expect(h.sends[1]?.preferences.musicVolume).toBe(0.4);
  expect(h.state().preferences.musicVolume).toBe(0.4);
  expect(h.state().pending).toBe(true);
  h.controller.ack({ seq: 2, result: 'ok' });
  expect(h.state().pending).toBe(false);
  h.controller.clear();
});

test('failed save remains pending and explicit retry can succeed', () => {
  const h = harness();
  h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
  h.controller.edit({ ...defaults, effects: false });
  h.controller.flush();
  h.controller.ack({ seq: 1, result: 'storage_error' });
  expect(h.state().pending).toBe(true);
  expect(h.state().error).not.toBeNull();
  h.controller.flush();
  h.controller.ack({ seq: 2, result: 'ok' });
  expect(h.state().error).toBeNull();
  expect(h.state().pending).toBe(false);
  h.controller.clear();
});

test('logout cancels timers, pending sends and stale acknowledgements for the old identity', () => {
  const h = harness();
  h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
  h.controller.edit({ ...defaults, musicVolume: 0.1 });
  h.controller.flush();
  h.controller.clear();
  h.controller.ack({ seq: 1, result: 'storage_error' });
  h.controller.bind({ profileId: 'B' }, h.sender);
  expect(h.state().preferences).toEqual(defaults);
  expect(h.state().error).toBeNull();
  expect(h.sends[1]?.preferences).toEqual(defaults);
  h.controller.clear();
});

// Value: protects=unacknowledged edits remain owned and retry after logout and same-profile login; fails_when=logout marks an offline or in-flight edit saved; why_new=the existing logout case checks only a different profile; seam=none; no_claim=the pure controller test does not verify browser storage or server writes.
for (const inFlight of [false, true]) {
  test(`logout retains same-profile pending audio after ${inFlight ? 'an in-flight save' : 'an offline edit'}`, () => {
    const h = harness();
    h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
    if (!inFlight) h.controller.disconnect();
    const pending = { ...defaults, musicVolume: 0.19, effects: false };
    h.controller.edit(pending);
    h.controller.flush();
    expect(h.sends).toHaveLength(inFlight ? 1 : 0);

    h.controller.clear();
    h.controller.ack({ seq: 1, result: 'ok' });
    h.controller.flush();
    expect(h.state().owner).toBe('A');
    expect(h.state().pending).toBe(true);
    expect(h.state().preferences).toEqual(pending);
    expect(h.sends).toHaveLength(inFlight ? 1 : 0);

    const restored = harness(h.state());
    restored.controller.bind({ profileId: 'A', audioPreferences: defaults }, restored.sender);
    expect(restored.sends).toEqual([{ seq: 1, preferences: pending }]);
    expect(restored.state().pending).toBe(true);
    restored.controller.ack({ seq: 1, result: 'ok' });
    expect(restored.state().pending).toBe(false);
    restored.controller.clear();
  });
}

// Value: protects=an active tab's acknowledged preferences after it logs out; fails_when=a replaced tab writes or replays its stale pending edit during passive logout; why_new=existing logout cases use one controller; seam=none; no_claim=the controller callbacks record cache writes without a browser or server.
test('passive logout in a replaced tab preserves audio acknowledged by the active tab', () => {
  let sharedCache: AudioCache = { preferences: { ...defaults }, owner: null, pending: false };
  let writes = 0;
  const persist = (cache: AudioCache) => {
    sharedCache = cache;
    writes++;
  };
  const replaced = harness(sharedCache, persist);
  const profile = { profileId: 'A', audioPreferences: defaults };
  const stale = { ...defaults, musicVolume: 0.23 };
  const saved = { ...defaults, effects: false, musicVolume: 0.78 };
  replaced.controller.bind(profile, replaced.sender);
  replaced.controller.edit(stale);
  replaced.controller.flush();
  replaced.controller.disconnect();

  const active = harness(sharedCache, persist);
  active.controller.bind(profile, active.sender);
  active.controller.edit(saved);
  active.controller.flush();
  active.controller.ack({ seq: 1, result: 'ok' });
  active.controller.ack({ seq: 2, result: 'ok' });
  active.controller.clear();
  expect(sharedCache.preferences).toEqual(saved);
  expect(sharedCache.pending).toBe(false);
  const writesBeforePassiveLogout = writes;

  replaced.controller.clear(false);
  expect(sharedCache.preferences).toEqual(saved);
  expect(sharedCache.pending).toBe(false);
  expect(writes).toBe(writesBeforePassiveLogout);

  replaced.controller.bind({ ...profile, audioPreferences: saved }, replaced.sender);
  expect(replaced.state().preferences).toEqual(saved);
  expect(replaced.sends).toEqual([{ seq: 1, preferences: stale }]);
  replaced.controller.clear();
});

// Value: protects=two profiles' pending edits through account switches and reload; fails_when=starting or acknowledging profile B overwrites the pending edit for A; why_new=existing cases cover returning directly to the same profile; seam=none; no_claim=reconstructing from a cache snapshot does not verify browser storage or server writes.
for (const reload of [false, true]) {
  test(`pending audio survives switching profiles ${reload ? 'with a reload' : 'without a reload'}`, () => {
    const h = harness();
    const a = { profileId: 'A', audioPreferences: defaults };
    const b = { profileId: 'B', audioPreferences: { ...defaults, effectsVolume: 0.54 } };
    const pendingA = { ...defaults, music: false, musicVolume: 0.19 };
    const pendingB = { ...b.audioPreferences, effects: false, effectsVolume: 0.44 };

    h.controller.bind(a, h.sender);
    h.controller.edit(pendingA);
    h.controller.flush();
    h.controller.clear();
    h.controller.bind(b, h.sender);
    expect(h.state().preferences).toEqual(b.audioPreferences);
    expect(h.sends).toEqual([{ seq: 1, preferences: pendingA }]);
    h.controller.edit(pendingB);
    h.controller.flush();

    const current = reload ? harness(structuredClone(h.state())) : h;
    if (reload) {
      h.controller.clear();
      current.controller.bind(b, current.sender);
    }
    const seqB = reload ? 1 : 2;
    expect(current.sends.at(-1)).toEqual({ seq: seqB, preferences: pendingB });
    current.controller.ack({ seq: seqB, result: 'ok' });
    expect(current.state().pending).toBe(false);
    current.controller.clear();

    current.controller.bind(a, current.sender);
    expect(current.state().preferences).toEqual(pendingA);
    expect(current.sends.at(-1)).toEqual({ seq: seqB + 1, preferences: pendingA });
    current.controller.ack({ seq: seqB + 1, result: 'ok' });
    current.controller.clear();
    current.controller.bind(b, current.sender);
    expect(current.state().preferences).toEqual(b.audioPreferences);
    expect(current.sends).toHaveLength(seqB + 1);
    current.controller.clear();
  });
}

test('slider edits coalesce until explicit final flush', () => {
  const h = harness();
  h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
  for (const musicVolume of [0.2, 0.3, 0.4]) h.controller.edit({ ...defaults, musicVolume });
  expect(h.sends).toHaveLength(0);
  h.controller.flush();
  expect(h.sends).toHaveLength(1);
  expect(h.sends[0]?.preferences.musicVolume).toBe(0.4);
  h.controller.clear();
});

test('idle slider writes send the latest value after the debounce interval', async () => {
  const h = harness();
  h.controller.bind({ profileId: 'A', audioPreferences: defaults }, h.sender);
  h.controller.edit({ ...defaults, musicVolume: 0.2 });
  h.controller.edit({ ...defaults, musicVolume: 0.7 });
  await Bun.sleep(200);
  expect(h.sends).toHaveLength(1);
  expect(h.sends[0]?.preferences.musicVolume).toBe(0.7);
  h.controller.clear();
});
