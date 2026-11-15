import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { IMAGE_SIZES } from '../../shared/bot-tools.ts';
import { renderVisionDigitsImage } from './vision-check.ts';

// Widest and narrowest digit strings the check can draw (randomInt(1000, 9999)).
const SAMPLE_DIGITS = ['1000', '8888', '9999'] as const;

test('the vision check image has the slot image size, so it tests what real rounds send', async () => {
  for (const size of IMAGE_SIZES) {
    for (const digits of SAMPLE_DIGITS) {
      const meta = await sharp(await renderVisionDigitsImage(digits, size)).metadata();
      expect({ size, digits, width: meta.width, height: meta.height }).toEqual({
        size,
        digits,
        width: size,
        height: size,
      });
    }
  }
});

test('the vision check digits are visible at every slot image size', async () => {
  for (const size of IMAGE_SIZES) {
    const stats = await sharp(await renderVisionDigitsImage('9999', size)).stats();
    // A blank canvas has no pixel variation; drawn digits give the red channel a wide spread.
    expect({ size, spread: (stats.channels[0]?.stdev ?? 0) > 10 }).toEqual({ size, spread: true });
  }
});
