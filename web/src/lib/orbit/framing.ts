import { Box3, BufferGeometry, type OrthographicCamera } from 'three';
import type { OrbitRig } from '@geoaissr/orbit-rig';
import { AVATAR_GESTURES } from '../../../../shared/avatar';
import { spinMotion } from './spin';
import { gestureDuration } from './types';

export function measureRig(rig: OrbitRig) {
  const resting = new Box3().setFromObject(rig.root);
  let top = resting.max.y;
  let radius = 0;
  // Sample the arm sweeps and the jump once per outfit. Keeping the same bounds for
  // every frame prevents the camera zooming when a gesture begins or the rig turns.
  const pose = new Box3();
  let sample = 1;
  for (const gesture of AVATAR_GESTURES) {
    for (const progress of [0.08, 0.2, 0.4, 0.6, 0.8, 0.92]) {
      const spin =
        gesture === 'spin'
          ? spinMotion({ kind: 'spin', at: 0 }, gestureDuration.spin * progress)
          : undefined;
      rig.update(sample++, { gesture, progress, spinWindup: spin?.windup, spinDrive: spin?.drive });
      rig.root.updateMatrixWorld(true);
      rig.root.traverseVisible((part) => {
        if (!('geometry' in part) || !(part.geometry instanceof BufferGeometry)) return;
        const geometry = part.geometry;
        if (!geometry.boundingBox) return;
        pose.copy(geometry.boundingBox).applyMatrix4(part.matrixWorld);
        top = Math.max(top, pose.max.y);
        radius = Math.max(
          radius,
          Math.hypot(Math.max(-pose.min.x, pose.max.x), Math.max(-pose.min.z, pose.max.z)),
        );
      });
    }
  }
  rig.update(0, {});
  return { width: radius * 2, height: top - resting.min.y, bottom: resting.min.y };
}

export function frameCamera(
  camera: OrthographicCamera,
  model: ReturnType<typeof measureRig>,
  aspect: number,
): void {
  const span = Math.max(model.height * 1.13, model.width / aspect);
  // Anchor feet to the CSS plinth, even in narrow cards and for petite builds.
  const focus = model.bottom + span * 0.45;
  camera.left = -span * aspect * 0.5;
  camera.right = -camera.left;
  camera.top = span * 0.5;
  camera.bottom = -camera.top;
  camera.position.set(0, focus + 1.03, 9.3);
  camera.lookAt(0, focus, 0);
  camera.updateProjectionMatrix();
}
