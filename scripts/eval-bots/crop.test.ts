import { expect, test } from 'bun:test';
import { computeCropBox, nearestFrameIndex, signedHeadingDiff, wrapDeg } from './crop.ts';

test('wrapDeg and signedHeadingDiff wrap around north', () => {
  expect(wrapDeg(-90)).toBe(270);
  expect(wrapDeg(450)).toBe(90);
  expect(signedHeadingDiff(10, 350)).toBe(20);
  expect(signedHeadingDiff(350, 10)).toBe(-20);
  expect(signedHeadingDiff(180, 0)).toBe(180);
});

test('nearestFrameIndex picks the closest of the four frames', () => {
  expect(nearestFrameIndex(0)).toBe(0);
  expect(nearestFrameIndex(44)).toBe(0);
  expect(nearestFrameIndex(46)).toBe(1);
  expect(nearestFrameIndex(200)).toBe(2);
  expect(nearestFrameIndex(350)).toBe(0);
  expect(nearestFrameIndex(-80)).toBe(3);
});

test('fov 90 at the frame centre returns the whole frame', () => {
  expect(computeCropBox({ frameSize: 1024, relativeHeading: 90, pitch: 0, fov: 90 })).toEqual({
    left: 0,
    top: 0,
    side: 1024,
  });
});

test('narrow fov at the centre crops a centred window with the tan side length', () => {
  const box = computeCropBox({ frameSize: 1024, relativeHeading: 0, pitch: 0, fov: 45 });
  expect(box.side).toBe(Math.round(1024 * Math.tan(Math.PI / 8)));
  expect(box.left).toBe(Math.round((1024 - box.side) / 2));
  expect(box.top).toBe(box.left);
});

test('heading offset shifts the crop right and pitch shifts it up', () => {
  const base = computeCropBox({ frameSize: 1024, relativeHeading: 0, pitch: 0, fov: 30 });
  const right = computeCropBox({ frameSize: 1024, relativeHeading: 10, pitch: 0, fov: 30 });
  const up = computeCropBox({ frameSize: 1024, relativeHeading: 0, pitch: 10, fov: 30 });
  const left = computeCropBox({ frameSize: 1024, relativeHeading: -10, pitch: 0, fov: 30 });
  expect(right.left - base.left).toBe(Math.round(512 * Math.tan((10 * Math.PI) / 180)));
  expect(left.left - base.left).toBe(-(right.left - base.left));
  expect(up.top).toBeLessThan(base.top);
  expect(up.left).toBe(base.left);
});

test('headings past 45 degrees use the next frame with a negative offset', () => {
  const box = computeCropBox({ frameSize: 1024, relativeHeading: 80, pitch: 0, fov: 30 });
  const centred = computeCropBox({ frameSize: 1024, relativeHeading: 90, pitch: 0, fov: 30 });
  expect(box.left).toBeLessThan(centred.left);
});

test('crops are clamped inside the frame and wide fov is clamped to the frame', () => {
  const edge = computeCropBox({ frameSize: 1024, relativeHeading: 44, pitch: 80, fov: 40 });
  expect(edge.left + edge.side).toBeLessThanOrEqual(1024);
  expect(edge.top).toBe(0);
  const wide = computeCropBox({ frameSize: 1024, relativeHeading: 30, pitch: 0, fov: 120 });
  expect(wide).toEqual({ left: 0, top: 0, side: 1024 });
});
