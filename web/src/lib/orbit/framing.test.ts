import { expect, test } from 'bun:test';
import { createAvatar } from '@geoaissr/orbit-rig';
import { Rasterizer } from '@geoaissr/orbit-rig/raster';
import { OrthographicCamera } from 'three';
import { defaultAvatar } from '../../../../shared/avatar';
import presets from '../../../../shared/avatar-presets.json';
import { frameCamera, measureRig } from './framing';
import { poseRig } from './pose';
import { gestureDuration, type StageState } from './types';

for (const [presetId, gesture] of [
  ['moss', 'joy'],
  ['rodeo', 'cheer'],
] as const) {
  test(`a narrow stage card contains the full ${presetId} ${gesture} animation`, () => {
    const preset = presets.find(({ id }) => id === presetId);
    if (!preset) throw new Error('Missing preset ' + presetId);
    const appearance = { ...defaultAvatar(false), ...preset.changes };
    const state: StageState = {
      appearance,
      gesture: { kind: gesture, at: 0 },
      yaw: 0,
      reduced: false,
      gazeX: 0,
      gazeY: 0,
      width: 108,
      height: 160,
      visible: true,
    };
    const { width, height } = state;
    const rig = createAvatar(appearance);
    const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 30);
    const raster = new Rasterizer();
    try {
      frameCamera(camera, measureRig(rig), width / height);
      raster.setSize(width, height);
      for (let frame = 0; frame <= 30; frame++) {
        const now = (gestureDuration[gesture] * frame) / 30;
        poseRig(rig, state, now, 3 + now / 1000);
        const pixels = raster.render(rig.root, camera);
        let painted = 0;
        let clipped = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if ((pixels[(y * width + x) * 4 + 3] ?? 0) < 128) continue;
            painted++;
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1) clipped++;
          }
        }
        expect(painted).toBeGreaterThan(1000);
        expect(clipped).toBe(0);
      }
    } finally {
      rig.dispose();
    }
  });
}
