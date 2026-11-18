import { DEFAULT_AUDIO_PREFERENCES, type AudioKind, type AudioPreferences } from './audio-catalog';
import { normalizeAudioPreferences, withAudioToggled, withAudioVolume } from './audio-preferences';
import { AudioProfileSync, type AudioCache, type AudioSender } from './audio-profile-sync';
import { AudioPlayer } from './audio-player';

const STORAGE_KEY = 'geoaissr.audio.v1';

function loadCache(): AudioCache {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const owner =
      saved &&
      typeof saved === 'object' &&
      'profileId' in saved &&
      typeof saved.profileId === 'string'
        ? saved.profileId
        : null;
    const pending = !!(
      saved &&
      typeof saved === 'object' &&
      'pending' in saved &&
      saved.pending === true
    );
    return { preferences: normalizeAudioPreferences(saved), owner, pending };
  } catch {
    return { preferences: normalizeAudioPreferences(null), owner: null, pending: false };
  }
}
const initial = loadCache();
export const audioPreferences = $state(initial.preferences);
export const audioPreferenceSync = $state<{ error: string | null }>({ error: null });
export const audioPlayer = new AudioPlayer();
const sync = new AudioProfileSync(initial, (state) => {
  Object.assign(audioPreferences, state.preferences);
  audioPreferenceSync.error = state.error;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...state.preferences,
        profileId: state.owner,
        pending: state.pending,
      }),
    );
  } catch {
    // Optional browser caching must not block local changes or server persistence.
  }
});

export function bindAudioProfile(
  profile: { profileId: string; audioPreferences?: AudioPreferences },
  sender: AudioSender,
): void {
  sync.bind(profile, sender);
}
export function audioProfileAck(ack: { seq: number; result: string; message?: string }): void {
  sync.ack(ack);
}
export function disconnectAudioProfile(): void {
  sync.disconnect();
}
export function clearAudioProfile(): void {
  sync.clear();
}
export function flushAudioPreferences(): void {
  sync.flush();
}

export function toggleAudio(kind: AudioKind): void {
  sync.edit(withAudioToggled(audioPreferences, kind));
  sync.flush();
}
export function setAudioVolume(kind: AudioKind, volume: number): void {
  sync.edit(withAudioVolume(audioPreferences, kind, volume));
}
export function resetAudioPreferences(): void {
  sync.edit({ ...DEFAULT_AUDIO_PREFERENCES });
  sync.flush();
}
