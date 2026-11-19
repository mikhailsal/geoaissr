import { gestureDuration, type OrbitGesture } from './types';

const revolution = 2 * Math.PI;
const brakeDuration = 380;

export function spinDuration(gesture: OrbitGesture): number {
  return gesture.spinDistance === undefined ? gestureDuration.spin : brakeDuration;
}

/** Angular velocity is expressed in radians per millisecond. */
export function spinMotion(gesture: OrbitGesture, now: number) {
  const duration = spinDuration(gesture);
  const t = Math.min(1, Math.max(0, (now - gesture.at) / duration));
  if (gesture.spinDistance !== undefined) {
    // Cubic Hermite trajectory from the boosted velocity to a resting, whole-turn angle.
    const distance = gesture.spinDistance;
    const tangent = (gesture.spinStartSpeed ?? 0) * duration;
    const angle =
      (gesture.spinStartAngle ?? 0) + distance * t * t * (3 - 2 * t) + tangent * t * (1 - t) ** 2;
    const speed = (6 * distance * t * (1 - t) + tangent * (1 - t) * (1 - 3 * t)) / duration;
    return { angle, speed, drive: Math.min(1, speed / 0.015), windup: 0 };
  }
  const angle = revolution * t ** 3 * (10 + t * (-15 + 6 * t));
  const speed = (revolution * 30 * t * t * (1 - t) ** 2) / duration;
  const drive = 16 * t * t * (1 - t) ** 2;
  const windup = t < 0.24 ? Math.sin((Math.PI * t) / 0.24) ** 2 * (1 - drive) : 0;
  return { angle, speed, drive, windup };
}

/** Replace the current braking trajectory at its present angle. No past clicks are retained. */
export function nextSpin(previous: OrbitGesture | null | undefined, at: number): OrbitGesture {
  if (previous?.kind !== 'spin' || at - previous.at >= spinDuration(previous))
    return { kind: 'spin', at };
  const { angle, speed } = spinMotion(previous, at);
  const boosted = Math.min(0.042, speed + 0.014);
  const coast = Math.max(revolution / 2, (boosted * brakeDuration) / 2);
  const finish = Math.ceil((angle + coast) / revolution) * revolution;
  return {
    kind: 'spin',
    at,
    spinStartAngle: angle,
    spinStartSpeed: boosted,
    spinDistance: finish - angle,
  };
}
