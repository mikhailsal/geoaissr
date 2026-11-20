import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createThumbStore } from '../../server/http/thumbs.ts';
import { createDatasetImageService } from './image-service.ts';

test('dataset service renders look crops and rejects move', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-img-'));
  try {
    const buf = await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r: 50, g: 90, b: 130 } },
    })
      .jpeg()
      .toBuffer();
    const paths = ['0', '1', '2', '3'].map((n) => path.join(dir, `${n}.jpg`)) as [
      string,
      string,
      string,
      string,
    ];
    for (const p of paths) writeFileSync(p, buf);
    const svc = createDatasetImageService(paths, 100, createThumbStore());
    const observed = await svc.getObserveViews({
      target: {
        panoId: 'p',
        lat: 0,
        lng: 0,
        countryId: 'X',
        countryNameRu: 'Т',
        region: 'world',
        fakeSceneIndex: 0,
      },
      size: 256,
    });
    expect(observed.map((v) => v.label)).toEqual([
      'Старт: 100° В',
      'Старт: 190° Ю',
      'Старт: 280° З',
      'Старт: 10° С',
    ]);
    const look = await svc.getLookView({
      panoId: 'p',
      lat: 0,
      lng: 0,
      heading: 110,
      pitch: 5,
      fov: 30,
      size: 256,
      fakeSceneIndex: 0,
    });
    const meta = await sharp(look.jpeg).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(look.label).toBe('Взгляд: 110° В');
    let moveFailed = false;
    await svc
      .getMoveView({
        panoId: 'p',
        lat: 0,
        lng: 0,
        heading: 0,
        step: 1,
        size: 256,
        fakeSceneIndex: 0,
      })
      .catch(() => {
        moveFailed = true;
      });
    expect(moveFailed).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
