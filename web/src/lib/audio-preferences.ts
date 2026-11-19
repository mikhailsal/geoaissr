import { DEFAULT_AUDIO_PREFERENCES, type AudioKind, type AudioPreferences } from './audio-catalog';

function volume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

export function normalizeAudioPreferences(value: unknown): AudioPreferences {
  const saved = value && typeof value === 'object' ? value : {};
  return {
    effects:
      'effects' in saved && typeof saved.effects === 'boolean'
        ? saved.effects
        : DEFAULT_AUDIO_PREFERENCES.effects,
    music:
      'music' in saved && typeof saved.music === 'boolean'
        ? saved.music
        : DEFAULT_AUDIO_PREFERENCES.music,
    effectsVolume: volume(
      'effectsVolume' in saved ? saved.effectsVolume : undefined,
      DEFAULT_AUDIO_PREFERENCES.effectsVolume,
    ),
    musicVolume: volume(
      'musicVolume' in saved ? saved.musicVolume : undefined,
      DEFAULT_AUDIO_PREFERENCES.musicVolume,
    ),
  };
}

export function withAudioVolume(
  preferences: AudioPreferences,
  kind: AudioKind,
  next: number,
): AudioPreferences {
  const key = kind === 'music' ? 'musicVolume' : 'effectsVolume';
  const normalized = volume(next, preferences[key]);
  return { ...preferences, [key]: normalized, [kind]: normalized > 0 };
}

export function withAudioToggled(preferences: AudioPreferences, kind: AudioKind): AudioPreferences {
  const key = kind === 'music' ? 'musicVolume' : 'effectsVolume';
  if (preferences[kind] && preferences[key] > 0) return { ...preferences, [kind]: false };
  return {
    ...preferences,
    [kind]: true,
    [key]: preferences[key] > 0 ? preferences[key] : DEFAULT_AUDIO_PREFERENCES[key],
  };
}
