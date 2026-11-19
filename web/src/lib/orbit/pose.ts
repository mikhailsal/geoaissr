import type { OrbitRig } from '@geoaissr/orbit-rig';
import { spinDuration, spinMotion } from './spin';
import { gestureDuration, type StageState } from './types';

export function poseRig(rig: OrbitRig, state: StageState, now: number, seconds: number): void {
  const gesture = state.gesture;
  const duration =
    gesture?.kind === 'spin' ? spinDuration(gesture) : gesture ? gestureDuration[gesture.kind] : 1;
  const progress = gesture && Math.max(0, (now - gesture.at) / duration);
  const active = gesture !== null && progress !== null && progress < 1;
  const pose = active && state.reduced ? 0.45 : (progress ?? 0);
  const spin = active && gesture.kind === 'spin' ? spinMotion(gesture, now) : undefined;
  rig.root.rotation.y = state.yaw + (state.reduced ? 0 : (spin?.angle ?? 0));
  const expression = {
    gazeX: state.gazeX,
    gazeY: state.gazeY,
    ...(active
      ? {
          gesture: gesture.kind,
          progress: pose,
          spinDrive: state.reduced ? 0.6 : spin?.drive,
          spinWindup: state.reduced ? 0 : spin?.windup,
        }
      : {}),
  };
  // A still pose has no subsequent frames for the Studio animator to ease toward it.
  if (state.reduced) {
    seconds = 1.9 + (active ? (pose * duration) / 1000 : 0);
    rig.update(seconds - 1, expression);
  }
  rig.update(seconds, expression);
}
