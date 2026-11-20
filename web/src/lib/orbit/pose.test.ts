import { expect, test } from 'bun:test';
import { createAvatar } from '@geoaissr/orbit-rig';
import { defaultAvatar } from '../../../../shared/avatar';
import { poseRig } from './pose';
import { gestureDuration, type StageState } from './types';

test('the rendered rig turns halfway at mid-spin and holds its chosen facing in reduced motion', () => {
  const appearance = defaultAvatar(false);
  const at = 10_000;
  const yaw = 0.35;
  const state: StageState = {
    appearance,
    gesture: { kind: 'spin', at },
    yaw,
    reduced: false,
    gazeX: 0,
    gazeY: 0,
    width: 108,
    height: 160,
    visible: true,
  };
  const rig = createAvatar(appearance);
  try {
    const halfway = at + gestureDuration.spin / 2;
    poseRig(rig, state, halfway, 2);
    expect(rig.root.rotation.y).toBeCloseTo(yaw + Math.PI, 8);
    poseRig(rig, state, at + gestureDuration.spin, 3);
    expect(rig.root.rotation.y).toBe(yaw);
    state.reduced = true;
    for (const progress of [0.25, 0.5, 0.75]) {
      poseRig(rig, state, at + progress * gestureDuration.spin, 4 + progress);
      expect(rig.root.rotation.y).toBe(yaw);
    }
  } finally {
    rig.dispose();
  }
});
