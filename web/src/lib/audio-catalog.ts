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
  panel: ['swoosh', 0.5],
  click: ['swoosh-short', 0.7],
  tick: ['effect-count-down-tick', 0.5],
  music: ['round-loop-suspense', 0.18],
} as const;

export type SoundId = keyof typeof AUDIO;
export interface AudioPreferences {
  effects: boolean;
  music: boolean;
}

export interface AudioOutput {
  cue(id: SoundId): void;
  track(channel: string, id: SoundId, key: string, offset: number, loop?: boolean): void;
  stop(channel: string): void;
  stopAll(): void;
}

export function audioUrl(id: SoundId): string {
  return `/audio/${AUDIO[id][0]}.ogg`;
}
