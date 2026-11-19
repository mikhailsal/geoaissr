import { z } from 'zod';

export type AudioKind = 'effects' | 'music';

export const audioPreferencesSchema = z
  .object({
    effects: z.boolean(),
    music: z.boolean(),
    effectsVolume: z.number().finite().min(0).max(1),
    musicVolume: z.number().finite().min(0).max(1),
  })
  .strict();

export type AudioPreferences = z.infer<typeof audioPreferencesSchema>;

export const updateAudioPreferencesMessageSchema = z
  .object({
    type: z.literal('update_audio_preferences'),
    seq: z.number().int().nonnegative(),
    preferences: audioPreferencesSchema,
  })
  .strict();

export const DEFAULT_AUDIO_PREFERENCES: Readonly<AudioPreferences> = {
  effects: true,
  music: true,
  effectsVolume: 1,
  musicVolume: 0.6,
};
