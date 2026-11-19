import type { Group } from 'three';

export interface OrbitRig {
  root: Group;
  update(
    seconds: number,
    pose: { gesture?: string; progress?: number; spinWindup?: number; spinDrive?: number },
  ): void;
  dispose(): void;
}

export function createAvatar(
  appearance: Record<string, string>,
  decorateHead?: (head: Group, faceZ: (x: number, y: number) => number) => void,
): OrbitRig;
