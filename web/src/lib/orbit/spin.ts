import { gestureDuration, type OrbitGesture } from './types';

export function spinMotion(gesture: OrbitGesture, now: number) {
  let turns = 0;
  let speed = 0;
  let windup = 0;
  for (const start of gesture.spinTimes ?? [gesture.at]) {
    const t = Math.min(1, Math.max(0, (now - start) / gestureDuration.spin));
    // Each impulse starts and ends at rest and adds exactly one revolution.
    // Adding their trajectories preserves the current angle and angular velocity on a tap.
    turns += t * t * t * (10 + t * (-15 + 6 * t));
    speed += 16 * t * t * (1 - t) * (1 - t);
    if (t < 0.24) windup = Math.max(windup, Math.sin((Math.PI * t) / 0.24) ** 2);
  }
  const drive = Math.min(1, speed);
  return { angle: turns * 2 * Math.PI, drive, windup: windup * (1 - drive) };
}
