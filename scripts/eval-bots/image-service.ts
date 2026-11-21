import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { BotImageService, RenderedBotImage } from '../../server/images/bot-image-service.ts';
import type { ThumbStore } from '../../server/http/thumbs.ts';
import {
  annotateStreetViewImage,
  createThumb,
  formatImageLabel,
  normalizeHeadingDeg,
} from '../../server/images/label.ts';
import { computeCropBox, nearestFrameIndex } from './crop.ts';

type Size = 256 | 400 | 640;

async function renderFrame(
  raw: Buffer,
  thumbStore: ThumbStore,
  action: 'observe' | 'look',
  heading: number,
  size: Size,
): Promise<RenderedBotImage> {
  const parts = formatImageLabel(action, heading);
  const jpeg = await annotateStreetViewImage(raw, size, parts);
  const thumbId = thumbStore.put(await createThumb(jpeg));
  return {
    jpeg,
    thumbId,
    thumbUrl: `/thumb/${thumbId}`,
    fullId: thumbId,
    fullUrl: `/thumb/${thumbId}`,
    label: parts.fullText,
  };
}

/**
 * Image service over the four dataset frames of one spot.
 * `baseHeadingDeg` is the compass heading of frame 0; when it is unknown (null) headings shown to
 * the bot are measured from frame 0 instead, which is a known limitation of such spots.
 */
export function createDatasetImageService(
  imagePaths: readonly [string, string, string, string],
  baseHeadingDeg: number | null,
  thumbStore: ThumbStore,
): BotImageService {
  const frames = imagePaths.map((p) => readFileSync(p));
  const base = baseHeadingDeg ?? 0;
  const frameAt = (idx: number): Buffer => {
    const raw = frames[idx];
    if (!raw) throw new Error(`Missing dataset frame ${idx}`);
    return raw;
  };
  return {
    // Decode every frame before the bot starts: a corrupt frame fails the round as an infra
    // error instead of reaching the bot as a failed observe and counting as a measured round.
    prepareStartViews: async () => {
      await Promise.all(frames.map((raw) => sharp(raw).raw().toBuffer()));
    },
    getObserveViews: ({ size }) =>
      Promise.all(
        [0, 1, 2, 3].map((idx) =>
          renderFrame(
            frameAt(idx),
            thumbStore,
            'observe',
            normalizeHeadingDeg(base + idx * 90),
            size,
          ),
        ),
      ),
    async getLookView({ heading, pitch, fov, size }): Promise<RenderedBotImage> {
      const relativeHeading = heading - base;
      const raw = frameAt(nearestFrameIndex(relativeHeading));
      const meta = await sharp(raw).metadata();
      const frameSize = Math.min(meta.width, meta.height);
      const box = computeCropBox({ frameSize, relativeHeading, pitch, fov });
      const cropped = await sharp(raw)
        .extract({ left: box.left, top: box.top, width: box.side, height: box.side })
        .toBuffer();
      return renderFrame(cropped, thumbStore, 'look', heading, size);
    },
    getMoveView: () => Promise.reject(new Error('Move is unavailable in eval-bots')),
    clearRound: () => undefined,
  };
}
