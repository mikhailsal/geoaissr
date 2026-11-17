import type { AudioPreferences } from './audio-catalog';
import { AudioPlayer } from './audio-player';

const STORAGE_KEY = 'geoaissr.audio.v1';

function loadPreferences(): AudioPreferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object' && 'effects' in parsed && 'music' in parsed) {
      if (typeof parsed.effects === 'boolean' && typeof parsed.music === 'boolean') {
        return { effects: parsed.effects, music: parsed.music };
      }
    }
  } catch {
    // Private browsing or a damaged preference must not prevent joining a game.
  }
  return { effects: true, music: true };
}

export const audioPreferences = $state(loadPreferences());
export const audioPlayer = new AudioPlayer();

export function toggleAudio(kind: keyof AudioPreferences): void {
  audioPreferences[kind] = !audioPreferences[kind];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(audioPreferences));
  } catch {
    // The setting still applies for this tab if persistence is unavailable.
  }
}
