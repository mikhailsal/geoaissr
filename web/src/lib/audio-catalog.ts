export const AUDIO = {
  loading: ['loading-round', 0.28],
  countdown: ['soft-countdown', 0.6],
  newRound: ['effect-new-round', 0.35],
  pin: ['place-guess-land', 0.7],
  locked: ['effect-guess-locked', 0.4],
  opponent: ['new-effect-opponent-guessed', 0.25],
  warning: ['effect-timer-countdown', 0.4],
  roundEnd: ['round-end', 0.32],
  gameEnd: ['game_end', 0.4],
  transition: ['swoosh', 0.5],
  click: ['swoosh-short', 0.7],
  tick: ['effect-count-down-tick', 0.5],
  music: ['round-loop-suspense', 0.18],
  musicExplorer: ['round-loop-explorer', 0.18],
  musicVoyage: ['round-loop-voyage', 0.18],
  musicRadar: ['round-loop-radar', 0.18],
  musicHorizon: ['round-loop-horizon', 0.18],
  musicPulse: ['round-loop-pulse', 0.18],
  musicCountdown: ['round-loop-countdown', 0.18],
} as const;

export type SoundId = keyof typeof AUDIO;
export const MUSIC_PLAYLIST = [
  'music',
  'musicExplorer',
  'musicVoyage',
  'musicRadar',
  'musicHorizon',
  'musicPulse',
  'musicCountdown',
] as const satisfies readonly SoundId[];

export const LOBBY_MUSIC = ['music'] as const satisfies readonly SoundId[];

export function isMusic(id: SoundId): boolean {
  return MUSIC_PLAYLIST.some((music) => music === id);
}

export type AudioKind = 'effects' | 'music';

export interface AudioPreferences {
  effects: boolean;
  music: boolean;
  effectsVolume: number;
  musicVolume: number;
}

export const DEFAULT_AUDIO_PREFERENCES: Readonly<AudioPreferences> = {
  effects: true,
  music: true,
  effectsVolume: 1,
  musicVolume: 0.85,
};

export interface AudioOutput {
  cue(id: SoundId): void;
  music(key: string, lobby?: boolean): void;
  track(channel: string, id: SoundId, key: string, offset: number, loop?: boolean): void;
  stop(channel: string): void;
  stopAll(): void;
}

export function audioUrl(id: SoundId): string {
  return `/audio/${AUDIO[id][0]}.ogg`;
}
