import sharp from 'sharp';
import type { BotImageSize } from '../../shared/bot-tools.ts';
import type { RoundTarget } from '../engine/types.ts';
import { GeoError } from '../errors.ts';
import type { ThumbStore } from '../http/thumbs.ts';
import type { FetchLike } from '../location.ts';
import type { QuotaManager } from '../storage/quota.ts';
import {
  annotateStreetViewImage,
  createThumb,
  formatImageLabel,
  normalizeHeadingDeg,
} from './label.ts';

export interface RenderedBotImage {
  jpeg: Buffer;
  thumbId: string;
  thumbUrl: string;
  label: string;
}

export interface BotImageService {
  prepareStartViews: (target: RoundTarget) => Promise<void>;
  getObserveViews: (opts: {
    target: RoundTarget;
    size: BotImageSize;
  }) => Promise<RenderedBotImage[]>;
  getLookView: (opts: {
    panoId: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    fov: number;
    size: BotImageSize;
    fakeSceneIndex: number;
  }) => Promise<RenderedBotImage>;
  getMoveView: (opts: {
    panoId: string;
    lat: number;
    lng: number;
    heading: number;
    step: number;
    size: BotImageSize;
    fakeSceneIndex: number;
  }) => Promise<RenderedBotImage>;
  clearRound: () => void;
}

const CARDINAL_HEADINGS = [0, 90, 180, 270] as const;

const FAKE_PALETTES = [
  { r: 58, g: 88, b: 122 },
  { r: 105, g: 82, b: 64 },
  { r: 54, g: 104, b: 84 },
  { r: 120, g: 76, b: 88 },
  { r: 86, g: 92, b: 118 },
  { r: 124, g: 106, b: 62 },
  { r: 66, g: 78, b: 92 },
] as const;

async function createFakeRawFrame(
  sceneIndex: number,
  heading: number,
  pitch: number,
): Promise<Buffer> {
  const pal = FAKE_PALETTES[Math.abs(sceneIndex) % FAKE_PALETTES.length] ?? FAKE_PALETTES[0];
  const shift = Math.round((normalizeHeadingDeg(heading) / 360) * 40);
  const sky = {
    r: Math.min(255, pal.r + shift),
    g: Math.min(255, pal.g + Math.round(pitch * 0.2) + 20),
    b: Math.min(255, pal.b + 25),
    alpha: 1,
  };
  return sharp({
    create: { width: 640, height: 640, channels: 4, background: sky },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function fetchStaticWithRetry(
  url: string,
  fetchImpl: FetchLike,
  quotaManager: QuotaManager,
): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!quotaManager.tryReserveStatic(1)) {
      throw new GeoError({
        code: 'GEO_QUOTA_CEILING',
        causeDetail: 'Static Street View monthly quota ceiling reached',
      });
    }
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
      if (res.status === 403) {
        throw new GeoError({
          code: 'GEO_GOOGLE_KEY_DENIED',
          causeDetail: 'Google Street View Static API returned HTTP 403',
        });
      }
      if (res.status === 429) {
        throw new GeoError({
          code: 'GEO_GOOGLE_QUOTA',
          causeDetail: 'Google Street View Static API returned HTTP 429',
        });
      }
      if (res.status === 404) {
        throw new Error('Панорама для этого ракурса недоступна (404)');
      }
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Street View Static HTTP ${res.status}`);
      }
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } catch (err) {
      if (err instanceof GeoError) throw err;
      lastErr = err;
    }
  }
  throw new Error(lastErr instanceof Error ? lastErr.message : 'Street View Static request failed');
}

async function renderLabeled(
  raw: Buffer,
  thumbStore: ThumbStore,
  action: 'observe' | 'look' | 'move',
  heading: number,
  size: BotImageSize,
  step?: number,
): Promise<RenderedBotImage> {
  const label = formatImageLabel(action, heading, step);
  const jpeg = await annotateStreetViewImage(raw, size, label);
  const thumbBuf = await createThumb(jpeg);
  const thumbId = thumbStore.put(thumbBuf);
  return {
    jpeg,
    thumbId,
    thumbUrl: `/thumb/${thumbId}`,
    label: label.fullText,
  };
}

interface RawFrameDeps {
  serverKey: string | null;
  fakeMode: boolean;
  quotaManager: QuotaManager;
  fetchImpl: FetchLike;
  rawCache: Map<string, Promise<Buffer>>;
}

async function fetchRawCached(
  deps: RawFrameDeps,
  params: {
    panoId: string;
    heading: number;
    pitch: number;
    fov: number;
    fakeSceneIndex: number;
  },
): Promise<Buffer> {
  const h = normalizeHeadingDeg(params.heading);
  const p = Math.round(params.pitch);
  const f = Math.round(params.fov);
  const key = `${params.panoId}:${h}:${p}:${f}`;
  const existing = deps.rawCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    if (deps.fakeMode) {
      return createFakeRawFrame(params.fakeSceneIndex, h, p);
    }
    if (!deps.serverKey) {
      throw new GeoError({
        code: 'GEO_ENV_KEY_MISSING',
        causeDetail: 'GOOGLE_MAPS_SERVER_KEY is missing',
      });
    }
    const qs = new URLSearchParams({
      size: '640x640',
      pano: params.panoId,
      heading: String(h),
      pitch: String(p),
      fov: String(f),
      source: 'outdoor',
      return_error_code: 'true',
      key: deps.serverKey,
    });
    return fetchStaticWithRetry(
      `https://maps.googleapis.com/maps/api/streetview?${qs.toString()}`,
      deps.fetchImpl,
      deps.quotaManager,
    );
  })();

  deps.rawCache.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    // After clearRound() a fresh fetch may own this key; only evict our own failed entry.
    if (deps.rawCache.get(key) === promise) deps.rawCache.delete(key);
    throw err;
  }
}

export function createBotImageService(opts: {
  serverKey: string | null;
  fakeMode: boolean;
  quotaManager: QuotaManager;
  thumbStore: ThumbStore;
  fetchImpl?: FetchLike;
}): BotImageService {
  const deps: RawFrameDeps = {
    serverKey: opts.serverKey,
    fakeMode: opts.fakeMode,
    quotaManager: opts.quotaManager,
    fetchImpl: opts.fetchImpl ?? ((u, init) => fetch(u, init)),
    rawCache: new Map(),
  };

  return {
    async prepareStartViews(target) {
      await Promise.all(
        CARDINAL_HEADINGS.map((heading) =>
          fetchRawCached(deps, {
            panoId: target.panoId,
            heading,
            pitch: 0,
            fov: 90,
            fakeSceneIndex: target.fakeSceneIndex,
          }),
        ),
      );
    },
    async getObserveViews({ target, size }) {
      const raws = await Promise.all(
        CARDINAL_HEADINGS.map((heading) =>
          fetchRawCached(deps, {
            panoId: target.panoId,
            heading,
            pitch: 0,
            fov: 90,
            fakeSceneIndex: target.fakeSceneIndex,
          }),
        ),
      );
      return Promise.all(
        CARDINAL_HEADINGS.map((heading, idx) => {
          const raw = raws[idx];
          if (!raw) throw new Error('Missing cardinal frame buffer');
          return renderLabeled(raw, opts.thumbStore, 'observe', heading, size);
        }),
      );
    },
    async getLookView({ panoId, heading, pitch, fov, size, fakeSceneIndex }) {
      const raw = await fetchRawCached(deps, { panoId, heading, pitch, fov, fakeSceneIndex });
      return renderLabeled(raw, opts.thumbStore, 'look', heading, size);
    },
    async getMoveView({ panoId, heading, step, size, fakeSceneIndex }) {
      const raw = await fetchRawCached(deps, {
        panoId,
        heading,
        pitch: 0,
        fov: 90,
        fakeSceneIndex,
      });
      return renderLabeled(raw, opts.thumbStore, 'move', heading, size, step);
    },
    clearRound() {
      deps.rawCache.clear();
    },
  };
}
