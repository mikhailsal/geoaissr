import type { Object3D, Camera } from 'three';

export class Rasterizer {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  setSize(width: number, height: number): void;
  render(root: Object3D, camera: Camera): Uint8ClampedArray<ArrayBuffer>;
}
