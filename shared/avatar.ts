import { z } from 'zod';
import { avatarChoices } from './avatar-catalog.ts';

export const GESTURE_INTERVAL_MS = 250;

export const AVATAR_GESTURES = [
  'gg',
  'laugh',
  'cheer',
  'wave',
  'think',
  'joy',
  'cool',
  'spin',
] as const;
export type AvatarGesture = (typeof AVATAR_GESTURES)[number];

const pigment = z.string().regex(/^#[0-9a-f]{6}$/i);
const linkedPigment = z.union([pigment, z.literal('match')]);

function choice(slot: keyof typeof avatarChoices) {
  const ids = new Set<string>(avatarChoices[slot]);
  return z.string().refine((value) => ids.has(value));
}

export const avatarAppearanceSchema = z
  .object({
    base: z.enum(['human', 'robot']),
    outfit: choice('outfit'),
    color: pigment,
    bottom: choice('bottom'),
    bottomColor: pigment,
    shoe: choice('shoe'),
    shoeColor: pigment,
    hair: choice('hair'),
    hairColor: pigment,
    dye: choice('dye'),
    dyeColor: pigment,
    skin: pigment,
    faceShape: choice('faceShape'),
    build: choice('build'),
    eyeStyle: choice('eyeStyle'),
    eyeColor: pigment,
    brow: choice('brow'),
    browColor: linkedPigment,
    nose: choice('nose'),
    freckles: choice('freckles'),
    mark: choice('mark'),
    mustache: choice('mustache'),
    mustacheColor: linkedPigment,
    beard: choice('beard'),
    beardColor: linkedPigment,
    gear: choice('gear'),
    gearColor: pigment,
    eyewear: choice('eyewear'),
    eyewearColor: pigment,
    earrings: choice('earrings'),
    earringColor: pigment,
    neckwear: choice('neckwear'),
    neckColor: pigment,
  })
  .strict();
export type AvatarAppearance = z.infer<typeof avatarAppearanceSchema>;

export function defaultAvatar(isAi: boolean): AvatarAppearance {
  return {
    base: isAi ? 'robot' : 'human',
    outfit: isAi ? 'tech' : 'bomber',
    color: isAi ? '#72b6cc' : '#ec813f',
    bottom: 'cargo',
    bottomColor: '#414351',
    shoe: 'sneakers',
    shoeColor: '#464554',
    hair: 'swoop',
    hairColor: '#483029',
    dye: 'solid',
    dyeColor: '#aa7291',
    skin: isAi ? '#b9c4d0' : '#e5ac80',
    faceShape: 'classic',
    build: 'classic',
    eyeStyle: 'classic',
    eyeColor: isAi ? '#5184a9' : '#543a2b',
    brow: 'classic',
    browColor: 'match',
    nose: 'button',
    freckles: isAi ? 'none' : 'light',
    mark: 'none',
    mustache: 'none',
    mustacheColor: 'match',
    beard: 'none',
    beardColor: 'match',
    gear: 'headset',
    gearColor: '#e88a48',
    eyewear: 'none',
    eyewearColor: '#444859',
    earrings: 'none',
    earringColor: '#dcb674',
    neckwear: 'none',
    neckColor: '#dcb674',
  };
}
