import { PARTICIPANT_COLOR_IDS, type ParticipantColorId } from '../../../shared/colors';

export interface SavedUserProfile {
  profileId: string;
  nick: string;
  color: ParticipantColorId;
}
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let temporaryId: string | null = null;
function key(): string {
  return `geoaissr:profile:${window.location.origin}`;
}
export function loadSavedProfile(): SavedUserProfile | null {
  try {
    const raw = window.localStorage.getItem(key());
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SavedUserProfile> | null;
    if (
      p &&
      typeof p.profileId === 'string' &&
      uuidV4.test(p.profileId) &&
      typeof p.nick === 'string' &&
      p.nick.trim().length > 0 &&
      p.nick.length <= 20 &&
      typeof p.color === 'string' &&
      PARTICIPANT_COLOR_IDS.includes(p.color)
    )
      return p as SavedUserProfile;
  } catch {
    /* Storage can be unavailable or malformed. */
  }
  return null;
}
export function saveProfile(profile: SavedUserProfile): void {
  try {
    window.localStorage.setItem(key(), JSON.stringify(profile));
  } catch {
    /* unavailable */
  }
}
function createUuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function getOrCreateProfileId(): string {
  return loadSavedProfile()?.profileId ?? (temporaryId ??= createUuidV4());
}
