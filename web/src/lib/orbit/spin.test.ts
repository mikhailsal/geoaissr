import { expect, test } from 'bun:test';
import { createAvatar } from '@geoaissr/orbit-rig';
import { defaultAvatar } from '../../../../shared/avatar';
import { nextSpin, spinDuration, spinMotion } from './spin';
import { gestureDuration, type OrbitGesture } from './types';

const start = 10_000;
const single: OrbitGesture = { kind: 'spin', at: start };

test('a single turn winds up before full speed and lands facing forward', () => {
  const before = spinMotion(single, start + 0.12 * gestureDuration.spin);
  const middle = spinMotion(single, start + 0.5 * gestureDuration.spin);
  expect(before.windup).toBeGreaterThan(0.7);
  expect(before.angle).toBeLessThan(0.15);
  expect(middle.windup).toBe(0);
  expect(middle.drive).toBe(1);
  expect(middle.angle).toBeCloseTo(Math.PI);
  expect(spinMotion(single, start + gestureDuration.spin)).toEqual({
    angle: 2 * Math.PI,
    speed: 0,
    drive: 0,
    windup: 0,
  });
});

test('rapid clicks boost from the current angle and brake promptly after the last click', () => {
  let motion = single;
  for (let i = 1; i <= 20; i++) {
    const at = start + i * 45;
    const before = spinMotion(motion, at);
    motion = nextSpin(motion, at);
    const boosted = spinMotion(motion, at);
    expect(boosted.angle).toBeCloseTo(before.angle, 9);
    expect(boosted.speed).toBeGreaterThanOrEqual(Math.min(before.speed, 0.042));
    if (i === 1) expect(boosted.speed).toBeGreaterThan(before.speed);
  }
  const stop = motion.at + spinDuration(motion);
  expect(stop - motion.at).toBeLessThanOrEqual(400);
  const rest = spinMotion(motion, stop);
  expect(rest.speed).toBe(0);
  expect(rest.angle / (2 * Math.PI)).toBeCloseTo(Math.round(rest.angle / (2 * Math.PI)), 9);
  expect(spinMotion(motion, stop + 2000)).toEqual(rest);
  expect(nextSpin(motion, stop)).toEqual({ kind: 'spin', at: stop });
});

test('the windup and pivot articulate the skeleton before rotating the whole avatar', () => {
  const rig = createAvatar(defaultAvatar(false));
  function joints(spinWindup: number, spinDrive: number): string[] {
    const pose = { gesture: 'spin', spinWindup, spinDrive };
    rig.update(0, pose);
    rig.update(1, pose);
    rig.root.updateMatrixWorld(true);
    const values: string[] = [];
    rig.root.traverse((joint) => {
      if (joint.type === 'Group') values.push(joint.matrix.elements.join(','));
    });
    return values;
  }
  try {
    const rest = joints(0, 0);
    const prepared = joints(1, 0);
    const turning = joints(0, 1);
    expect(prepared.filter((matrix, i) => matrix !== rest[i]).length).toBeGreaterThan(8);
    expect(turning.filter((matrix, i) => matrix !== prepared[i]).length).toBeGreaterThan(8);
    expect(rig.root.rotation.y).toBe(0);
  } finally {
    rig.dispose();
  }
});
