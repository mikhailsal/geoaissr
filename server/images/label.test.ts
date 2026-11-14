import { expect, test } from 'bun:test';
import sharp from 'sharp';
import {
  annotateStreetViewImage,
  createThumb,
  formatImageLabel,
  headingToCardinalRu,
} from './label.ts';

test('headingToCardinalRu maps 8 sectors cleanly including wraparound', () => {
  expect(headingToCardinalRu(0)).toBe('С');
  expect(headingToCardinalRu(45)).toBe('СВ');
  expect(headingToCardinalRu(90)).toBe('В');
  expect(headingToCardinalRu(135)).toBe('ЮВ');
  expect(headingToCardinalRu(180)).toBe('Ю');
  expect(headingToCardinalRu(225)).toBe('ЮЗ');
  expect(headingToCardinalRu(270)).toBe('З');
  expect(headingToCardinalRu(315)).toBe('СЗ');
  expect(headingToCardinalRu(-90)).toBe('З');
});

test('annotateStreetViewImage resizes accurately, strips EXIF/XMP, and creates <=15KB thumb', async () => {
  const rawWithExif = await sharp({
    create: { width: 640, height: 640, channels: 3, background: { r: 60, g: 110, b: 160 } },
  })
    .withMetadata({ exif: { IFD0: { ImageDescription: 'SECRET_EXIF_LEAK' } } })
    .jpeg()
    .toBuffer();

  const label = formatImageLabel('observe', 90);
  expect(label.fullText).toBe('Старт: 90° В');

  const out256 = await annotateStreetViewImage(rawWithExif, 256, label);
  const meta256 = await sharp(out256).metadata();
  expect(meta256.width).toBe(256);
  expect(meta256.height).toBe(256);
  expect(meta256.exif).toBeUndefined();
  expect(meta256.xmp).toBeUndefined();
  expect(out256.toString('latin1')).not.toContain('SECRET_EXIF_LEAK');

  const thumb = await createThumb(out256);
  const metaThumb = await sharp(thumb).metadata();
  expect(metaThumb.width).toBe(160);
  expect(metaThumb.height).toBe(160);
  expect(thumb.byteLength).toBeLessThanOrEqual(15 * 1024);
});
