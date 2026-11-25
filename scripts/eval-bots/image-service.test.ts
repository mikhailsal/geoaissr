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
        map: 'standard',
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

async function rejects(promise: Promise<unknown>): Promise<boolean> {
  return promise.then(
    () => false,
    () => true,
  );
}

// Value: protects=a corrupt dataset frame fails the round before the bot starts; fails_when=bad bytes reach the bot as a failed observe and the round counts as measured; why_new=frames were only read, never decoded, before the round; seam=none; no_claim=the round record wording.
test('prepareStartViews rejects a frame that does not decode', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-img-'));
  try {
    const good = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    const paths = ['0', '1', '2', '3'].map((n) => path.join(dir, `${n}.jpg`)) as [
      string,
      string,
      string,
      string,
    ];
    for (const p of paths) writeFileSync(p, good);
    const target = {
      panoId: 'p',
      lat: 0,
      lng: 0,
      countryId: 'X',
      countryNameRu: 'Т',
      map: 'standard' as const,
      region: 'world' as const,
      fakeSceneIndex: 0,
    };
    await createDatasetImageService(paths, 0, createThumbStore()).prepareStartViews(target);
    writeFileSync(paths[2], good.subarray(0, Math.floor(good.length / 2)));
    const truncated = createDatasetImageService(paths, 0, createThumbStore());
    expect(await rejects(truncated.prepareStartViews(target))).toBe(true);
    writeFileSync(paths[2], 'not a jpeg');
    const garbage = createDatasetImageService(paths, 0, createThumbStore());
    expect(await rejects(garbage.prepareStartViews(target))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
