import type { AvatarAppearance, AvatarGesture } from '$shared/avatar';

export interface OrbitGesture {
  kind: AvatarGesture;
  /** Local receipt time in milliseconds since epoch. */
  at: number;
}

export const gestureDuration: Record<AvatarGesture, number> = {
  spin: 1340,
  wave: 2500,
  gg: 2200,
  laugh: 2300,
  cheer: 2600,
  think: 2700,
  joy: 2500,
  cool: 2400,
};

export interface StageState {
  appearance: AvatarAppearance;
  gesture: OrbitGesture | null;
  width: number;
  height: number;
  visible: boolean;
  reduced: boolean;
}

export type StageMessage = { id: number; state: StageState | null };
export type Surface = HTMLCanvasElement | OffscreenCanvas;
export type Paint = (id: number, image: Surface, renderer: string) => void;
