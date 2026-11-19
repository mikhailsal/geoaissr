import { defaultAvatar, type AvatarAppearance } from './avatar.ts';
import presets from './avatar-presets.json';

/** Keep an existing profile's starter look stable across room and server restarts. */
export function starterAvatar(profileId: string): AvatarAppearance {
  let hash = 0;
  for (const char of profileId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const preset = presets[hash % presets.length];
  return { ...defaultAvatar(false), ...preset?.changes };
}
