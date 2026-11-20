import { PARTICIPANT_COLOR_IDS, type ParticipantColorId } from '../../../shared/colors';
import { normalizeProfileToken } from '../../../shared/profile-token';
export { normalizeProfileToken, formatProfileToken } from '../../../shared/profile-token';
export interface SavedUserProfile {
  version?: 2;
  profileId: string;
  profileToken?: string;
  nick: string;
  color: ParticipantColorId;
}
let temporaryId: string | null = null;
let memoryProfile: SavedUserProfile | null = null;
let memoryOrigin: string | null = null;
export function isOwnerEntry(): boolean {
  return new URLSearchParams(window.location.search).get('entry') === 'owner';
}
/** Keep a remote owner's profile and seat independent of guest sign-in on the same origin. */
export function profileStorageScope(): string {
  const origin = window.location.origin;
  return isOwnerEntry() ? `${origin}:owner` : origin;
}
export function profileStorageKey(): string {
  return `geoaissr:profile:${profileStorageScope()}`;
}
export function logoutStorageKey(): string {
  return `geoaissr:logout:${window.location.origin}`;
}
export function publishLogout(profileId: string | null): void {
  try {
    window.localStorage.setItem(
      logoutStorageKey(),
      JSON.stringify({ profileId, nonce: `${Date.now()}-${Math.random()}` }),
    );
  } catch {
    /* Other tabs cannot be notified when storage is unavailable. */
  }
}
export function isProfileLogout(event: StorageEvent, profileId: string | null): boolean {
  if (event.key !== logoutStorageKey() || !event.newValue || event.newValue.length > 256)
    return false;
  try {
    const notice: unknown = JSON.parse(event.newValue);
    return (
      typeof notice === 'object' &&
      notice !== null &&
      'profileId' in notice &&
      notice.profileId === profileId
    );
  } catch {
    return false;
  }
}
function validProfile(value: unknown): SavedUserProfile | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as {
    profileId?: string;
    profileToken?: string;
    version?: number;
    nick?: string;
    color?: ParticipantColorId;
  };
  if (
    typeof p.profileId !== 'string' ||
    !p.profileId.length ||
    p.profileId.length > 64 ||
    typeof p.nick !== 'string' ||
    !p.nick.trim() ||
    p.nick.length > 20 ||
    !PARTICIPANT_COLOR_IDS.includes(p.color as ParticipantColorId)
  )
    return null;
  if (p.version !== undefined && p.version !== 2) return null;
  const color = p.color as ParticipantColorId;
  if (p.version === 2 || p.profileToken !== undefined) {
    const profileToken =
      typeof p.profileToken === 'string' ? normalizeProfileToken(p.profileToken) : null;
    if (!profileToken) return null;
    return { version: 2, profileId: p.profileId, profileToken, nick: p.nick.trim(), color };
  }
  return { profileId: p.profileId, nick: p.nick.trim(), color };
}
export function loadSavedProfile(): SavedUserProfile | null {
  if (memoryOrigin !== profileStorageScope()) {
    memoryProfile = null;
    memoryOrigin = profileStorageScope();
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(profileStorageKey());
  } catch {
    return memoryProfile;
  }
  if (raw) {
    try {
      memoryProfile = validProfile(JSON.parse(raw));
    } catch {
      memoryProfile = null;
    }
  }
  return memoryProfile;
}
export function saveProfile(profile: SavedUserProfile): void {
  memoryOrigin = profileStorageScope();
  memoryProfile = validProfile(profile);
  if (!memoryProfile) return;
  try {
    window.localStorage.setItem(profileStorageKey(), JSON.stringify(memoryProfile));
  } catch {
    /* Page-session cache remains available. */
  }
}
export function clearProfile(clearShared = true): void {
  memoryProfile = null;
  temporaryId = null;
  if (!clearShared) return;
  try {
    window.localStorage.removeItem(profileStorageKey());
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
