import { expect, test } from 'bun:test';
import { createAvatar } from '@geoaissr/orbit-rig';
import { defaultAvatar } from '../../../../shared/avatar';
import { spinMotion } from './spin';
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
    drive: 0,
    windup: 0,
  });
});

test('a second impulse preserves the current pose and accelerates the ongoing turn', () => {
  const at = start + 370;
  const twice: OrbitGesture = { kind: 'spin', at, spinTimes: [start, at] };
  expect(spinMotion(twice, at)).toEqual(spinMotion(single, at));
  const velocity = (gesture: OrbitGesture, time: number) =>
    spinMotion(gesture, time + 1).angle - spinMotion(gesture, time).angle;
  expect(velocity(twice, at)).toBeCloseTo(velocity(single, at), 6);
  expect(velocity(twice, at + 300)).toBeGreaterThan(velocity(single, at + 300));
  expect(spinMotion(twice, at + gestureDuration.spin).angle).toBeCloseTo(4 * Math.PI);
  const afterFirst = start + gestureDuration.spin + 20;
  expect(spinMotion(twice, afterFirst).angle - 2 * Math.PI).toBeCloseTo(
    spinMotion({ kind: 'spin', at }, afterFirst).angle,
  );
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
