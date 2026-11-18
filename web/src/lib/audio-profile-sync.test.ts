import { expect, test } from 'bun:test';
import { DEFAULT_AUDIO_PREFERENCES as defaults, type AudioPreferences } from './audio-catalog';
import { AudioProfileSync, type AudioCache } from './audio-profile-sync';

// Value: protects=durable audio edits remain with their authenticated profile; fails_when=server restore echoes or stale acknowledgements erase newer settings; why_new=audio was browser-only; seam=pure controller with transport recording; no_claim=does not verify real server writes or browser UI.

function harness(
  cache: AudioCache = { preferences: { ...defaults }, owner: null, pending: false },
) {
  let state = { ...cache, error: null as string | null };
  const sends: { seq: number; preferences: AudioPreferences }[] = [];
  let seq = 0;
  const controller = new AudioProfileSync(cache, (snapshot) => {
    state = snapshot;
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
