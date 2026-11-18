import type { AudioKind, AudioPreferences } from './audio-catalog';
import { normalizeAudioPreferences, withAudioToggled, withAudioVolume } from './audio-preferences';
import { AudioPlayer } from './audio-player';

const STORAGE_KEY = 'geoaissr.audio.v1';

function loadPreferences(): AudioPreferences {
  try {
    return normalizeAudioPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    // Private browsing or a damaged preference must not prevent joining a game.
    return normalizeAudioPreferences(null);
  }
}

export const audioPreferences = $state(loadPreferences());
export const audioPlayer = new AudioPlayer();

function savePreferences(preferences: AudioPreferences): void {
  Object.assign(audioPreferences, preferences);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(audioPreferences));
  } catch {
    // The setting still applies for this tab if persistence is unavailable.
  }
}

export function toggleAudio(kind: AudioKind): void {
  savePreferences(withAudioToggled(audioPreferences, kind));
}

export function setAudioVolume(kind: AudioKind, volume: number): void {
  savePreferences(withAudioVolume(audioPreferences, kind, volume));
}
