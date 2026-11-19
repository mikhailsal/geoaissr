import { createAvatar } from '@geoaissr/orbit-rig';
import { expect, test } from 'bun:test';
import type { Group } from 'three';
import { defaultAvatar } from '../../../../shared/avatar';

test('gaze turns the neck toward the pointer while the body keeps its chosen yaw', () => {
  function neck(gazeX: number, gazeY: number) {
    const joints: { head?: Group } = {};
    const rig = createAvatar(defaultAvatar(false), (head) => {
      joints.head = head;
    });
    try {
      rig.root.rotation.y = 1.2;
      for (let frame = 0; frame < 40; frame++) rig.update(frame / 60, { gazeX, gazeY });
      expect(rig.root.rotation.y).toBe(1.2);
      if (!joints.head) throw new Error('Avatar has no head joint');
      const { x, y } = joints.head.rotation;
      return { x, y };
    } finally {
      rig.dispose();
    }
  }

  const leftDown = neck(-1, -1);
  const rightUp = neck(1, 1);
  expect(rightUp.y - leftDown.y).toBeGreaterThan(0.3);
  expect(leftDown.x - rightUp.x).toBeGreaterThan(0.1);
});
