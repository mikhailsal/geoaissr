import { expect, test } from 'bun:test';
import { DEFAULT_AUDIO_PREFERENCES } from './audio-catalog';
import { normalizeAudioPreferences, withAudioToggled, withAudioVolume } from './audio-preferences';

// Value: protects=saved audio choices and independent volume/mute behavior; fails_when=legacy mute is lost or unmuting overwrites a saved level; why_new=volume preferences did not exist; seam=pure storage-value normalization; no_claim=does not exercise browser persistence or native audio gains.

test('old boolean preferences migrate without losing mute choices', () => {
  expect(normalizeAudioPreferences({ effects: false, music: true })).toEqual({
    ...DEFAULT_AUDIO_PREFERENCES,
    effects: false,
  });
  expect(normalizeAudioPreferences(null)).toEqual(DEFAULT_AUDIO_PREFERENCES);
});

test('saved explicit levels survive normalization while corrupt levels are bounded', () => {
  expect(normalizeAudioPreferences({ musicVolume: 0.42, effectsVolume: 0 })).toEqual({
    ...DEFAULT_AUDIO_PREFERENCES,
    musicVolume: 0.42,
    effectsVolume: 0,
  });
  expect(normalizeAudioPreferences({ musicVolume: 3, effectsVolume: -1 })).toEqual({
    ...DEFAULT_AUDIO_PREFERENCES,
    musicVolume: 1,
    effectsVolume: 0,
  });
  expect(normalizeAudioPreferences({ musicVolume: NaN, effectsVolume: '0.2' })).toEqual(
    DEFAULT_AUDIO_PREFERENCES,
  );
});

test('mute preserves the level and adjusting it reenables only that channel', () => {
  const initial = { ...DEFAULT_AUDIO_PREFERENCES, musicVolume: 0.42 };
  const muted = withAudioToggled(initial, 'music');
  expect(muted).toEqual({ ...initial, music: false });
  expect(withAudioToggled(muted, 'music')).toEqual(initial);
  expect(withAudioVolume(muted, 'music', 0.3)).toEqual({ ...initial, musicVolume: 0.3 });
});

test('zero silences and unmute restores channel default; volume is clamped', () => {
  const zero = withAudioVolume(DEFAULT_AUDIO_PREFERENCES, 'music', 0);
  expect(zero).toEqual({ ...DEFAULT_AUDIO_PREFERENCES, music: false, musicVolume: 0 });
  expect(withAudioToggled(zero, 'music')).toEqual(DEFAULT_AUDIO_PREFERENCES);
  expect(withAudioVolume(zero, 'effects', 9).effectsVolume).toBe(1);
  expect(withAudioVolume(zero, 'effects', -2).effects).toBe(false);
});
