/**
 * Look-view geometry for dataset frames. Each frame is a rectilinear perspective image with a
 * 90 degree field of view, so its focal length in pixels is `size / 2`. A look is approximated
 * by cropping the nearest frame, which is exact for a pinhole camera near the frame centre and
 * drifts slowly toward the frame edge.
 *
 * The game turns a `zoom` argument into `fov = clamp(round(90 / zoom), 10, 120)` in the tool
 * queue before an image service is called, so the dataset service only ever receives `fov`.
 */

export const FRAME_FOV_DEG = 90;

export interface CropBox {
  left: number;
  top: number;
  /** Side of the square crop in source pixels. */
  side: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Heading in [0, 360). */
export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed difference `a - b` wrapped to (-180, 180]. */
export function signedHeadingDiff(a: number, b: number): number {
  const d = wrapDeg(a - b);
  return d > 180 ? d - 360 : d;
}

/** Index (0-3) of the frame whose centre is closest to `relativeHeading` (relative to frame 0). */
export function nearestFrameIndex(relativeHeading: number): number {
  return Math.round(wrapDeg(relativeHeading) / 90) % 4;
}

/**
 * Crop box inside a `frameSize` x `frameSize` frame for a requested view.
 * `relativeHeading` is measured from the centre of frame 0 (clockwise), `pitch` is positive up,
 * `fov` is the requested field of view. Widening beyond the frame (fov > 90) is clamped to the
 * whole frame, and a crop that would leave the frame is shifted back inside it.
 */
export function computeCropBox(opts: {
  frameSize: number;
  relativeHeading: number;
  pitch: number;
  fov: number;
}): CropBox {
  const { frameSize } = opts;
  const half = frameSize / 2;
  const idx = nearestFrameIndex(opts.relativeHeading);
  const dyaw = signedHeadingDiff(opts.relativeHeading, idx * 90);
  const pitch = Math.max(-89, Math.min(89, opts.pitch));
  const fov = Math.max(1, Math.min(179, opts.fov));
  const focal = half / Math.tan(toRad(FRAME_FOV_DEG / 2));
  const side = Math.max(1, Math.min(frameSize, Math.round(2 * focal * Math.tan(toRad(fov / 2)))));
  const centreX = half + focal * Math.tan(toRad(dyaw));
  const centreY = half - focal * Math.tan(toRad(pitch));
  const clamp = (v: number): number => Math.max(0, Math.min(frameSize - side, Math.round(v)));
  return { left: clamp(centreX - side / 2), top: clamp(centreY - side / 2), side };
}
