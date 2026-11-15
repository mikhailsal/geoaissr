import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { GeoError } from '../errors.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { createQuotaManager } from '../storage/quota.ts';
import { createBotImageService } from './bot-image-service.ts';

test('bot image service uses in-round cache and reserves static quota before fetch', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-img-'));
  try {
    const quota = createQuotaManager(path.join(dir, 'quota.json'));
    const thumbs = createThumbStore();
    const rawJpg = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 90, g: 120, b: 140 } },
    })
      .jpeg()
      .toBuffer();

    const requestedUrls: string[] = [];
    const svc = createBotImageService({
      serverKey: 'srv-key',
      fakeMode: false,
      quotaManager: quota,
      thumbStore: thumbs,
      fetchImpl: (url) => {
        requestedUrls.push(url);
        return Promise.resolve(new Response(new Uint8Array(rawJpg), { status: 200 }));
      },
    });

    const target = {
      panoId: 'p-cache',
      lat: 50,
      lng: 10,
      countryId: '276',
      countryNameRu: 'Германия',
      region: 'europe' as const,
      fakeSceneIndex: 0,
    };
    await svc.prepareStartViews(target);
    expect(requestedUrls.length).toBe(4);
    expect(requestedUrls[0]).toContain('return_error_code=true');
    expect(quota.getState().staticRequests).toBe(4);

    // Second call for a smaller bot reuses cache without hitting Google or quota again.
    const views = await svc.getObserveViews({ target, size: 256 });
    expect(views.length).toBe(4);
    expect(requestedUrls.length).toBe(4);
    expect(quota.getState().staticRequests).toBe(4);
    const first = views[0];
    expect(first).toBeDefined();
    if (first) {
      const thumbBuf = thumbs.get(first.thumbId);
      const fullBuf = thumbs.get(first.fullId);
      expect(thumbBuf).not.toBeNull();
      expect(fullBuf).not.toBeNull();
      expect(first.fullUrl).toBe(`/thumb/${first.fullId}`);
      if (thumbBuf && fullBuf) {
        const thumbMeta = await sharp(thumbBuf).metadata();
        const fullMeta = await sharp(fullBuf).metadata();
        expect(thumbMeta.width).toBe(160);
        expect(fullMeta.width).toBe(256);
      }
    }

    svc.clearRound();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bot image service maps HTTP 403 to GEO_GOOGLE_KEY_DENIED without retry', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-img403-'));
  try {
    const quota = createQuotaManager(path.join(dir, 'quota.json'));
    const svc = createBotImageService({
      serverKey: 'bad-key',
      fakeMode: false,
      quotaManager: quota,
      thumbStore: createThumbStore(),
      fetchImpl: () => Promise.resolve(new Response('forbidden', { status: 403 })),
    });
    let caught: unknown;
    try {
      await svc.getLookView({
        panoId: 'p-403',
        lat: 0,
        lng: 0,
        heading: 45,
        pitch: 0,
        fov: 90,
        size: 400,
        fakeSceneIndex: 0,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GeoError);
    expect((caught as GeoError).code).toBe('GEO_GOOGLE_KEY_DENIED');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bot image service reserves static quota per retry attempt on 500 -> 200', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-img-retry-'));
  try {
    const quota = createQuotaManager(path.join(dir, 'quota.json'));
    const rawJpg = await sharp({
      create: { width: 256, height: 256, channels: 3, background: { r: 30, g: 60, b: 90 } },
    })
      .jpeg()
      .toBuffer();
    let calls = 0;
    const svc = createBotImageService({
      serverKey: 'srv-key',
      fakeMode: false,
      quotaManager: quota,
      thumbStore: createThumbStore(),
      fetchImpl: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve(new Response('err', { status: 500 }));
        return Promise.resolve(new Response(new Uint8Array(rawJpg), { status: 200 }));
      },
    });
    await svc.getLookView({
      panoId: 'p-retry',
      lat: 0,
      lng: 0,
      heading: 0,
      pitch: 0,
      fov: 90,
      size: 256,
      fakeSceneIndex: 0,
    });
    expect(calls).toBe(2);
    expect(quota.getState().staticRequests).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
