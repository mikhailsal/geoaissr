import { expect, test } from 'bun:test';
import { createThumbStore } from './thumbs.ts';

test('thumb store issues 128-bit hex ids and clears to null (404) on return to lobby', () => {
  const store = createThumbStore();
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const id = store.put(buf);
  expect(id).toMatch(/^[a-f0-9]{32}$/);
  expect(store.get(id)).toEqual(buf);
  expect(store.get('not-a-valid-id')).toBeNull();
  expect(store.size()).toBe(1);

  store.clear();
  expect(store.size()).toBe(0);
  expect(store.get(id)).toBeNull();
});

test('thumb store evicts least-recently-used entries when maxBytes is exceeded', () => {
  const store = createThumbStore(10);
  const a = store.put(Buffer.alloc(4, 1));
  const b = store.put(Buffer.alloc(4, 2));
  expect(store.size()).toBe(2);

  // Touch `a` so `b` becomes least-recently-used.
  expect(store.get(a)).not.toBeNull();

  // Adding 4 bytes (4 + 4 + 4 = 12 > 10) should evict `b`, keeping `a` and `c`.
  const c = store.put(Buffer.alloc(4, 3));
  expect(store.get(b)).toBeNull();
  expect(store.get(a)).not.toBeNull();
  expect(store.get(c)).not.toBeNull();
  expect(store.size()).toBe(2);

  // An oversized buffer (> maxBytes) should be dropped without evicting `a` or `c`.
  const oversized = store.put(Buffer.alloc(11, 4));
  expect(store.get(oversized)).toBeNull();
  expect(store.get(a)).not.toBeNull();
  expect(store.get(c)).not.toBeNull();
  expect(store.size()).toBe(2);
});

test('thumb store evicts full-tier entries globally before thumb-tier entries', () => {
  const store = createThumbStore(10);
  const full1 = store.put(Buffer.alloc(4, 1), 'full');
  const thumb1 = store.put(Buffer.alloc(2, 2), 'thumb');
  const full2 = store.put(Buffer.alloc(4, 3), 'full');
  expect(store.size()).toBe(3);

  // Adding a 3-byte thumb (10 + 3 = 13 > 10) must evict full1 first, preserving thumb1.
  const thumb2 = store.put(Buffer.alloc(3, 4), 'thumb');
  expect(store.get(full1)).toBeNull();
  expect(store.get(thumb1)).not.toBeNull();
  expect(store.get(full2)).not.toBeNull();
  expect(store.get(thumb2)).not.toBeNull();
});

// Value: protects=strip thumbnails survive rejected full images and cache accounting survives eviction and clear; fails_when=full admission evicts thumbs or byte accounting drifts; why_new=existing tests only admit thumbnails under pressure; seam=none; no_claim=unit cache behavior only
test('thumb store rejects full-tier inserts rather than evicting thumbnails', () => {
  const store = createThumbStore(10);
  const thumb1 = store.put(Buffer.alloc(4, 1), 'thumb');
  const thumb2 = store.put(Buffer.alloc(4, 2), 'thumb');
  const rejectedFull = store.put(Buffer.alloc(3, 3), 'full');

  expect(store.get(rejectedFull)).toBeNull();
  expect(store.get(thumb1)).not.toBeNull();
  expect(store.get(thumb2)).not.toBeNull();
  expect(store.size()).toBe(2);

  const thumb3 = store.put(Buffer.alloc(4, 4), 'thumb');
  const fittingFull = store.put(Buffer.alloc(2, 5), 'full');
  expect(store.get(thumb1)).toBeNull();
  expect(store.get(thumb2)).not.toBeNull();
  expect(store.get(thumb3)).not.toBeNull();
  expect(store.get(fittingFull)).not.toBeNull();

  store.clear();
  const fullAfterClear = store.put(Buffer.alloc(10, 6), 'full');
  expect(store.get(fullAfterClear)).not.toBeNull();
  expect(store.size()).toBe(1);
});

// Value: protects=rejected full images preserve cached previews while fitting replacements remain possible; fails_when=rejection evicts cached frames or fitting replacements are rejected; why_new=existing tests do not reject full inserts with cached full images; seam=none; no_claim=unit cache behavior only
test('thumb store preserves existing full images when rejecting a full-tier insert', () => {
  const store = createThumbStore(10);
  const thumb = store.put(Buffer.alloc(6, 1), 'thumb');
  const full = store.put(Buffer.alloc(3, 2), 'full');
  const rejectedFull = store.put(Buffer.alloc(5, 3), 'full');

  expect(store.get(rejectedFull)).toBeNull();
  expect(store.get(thumb)).not.toBeNull();
  expect(store.get(full)).not.toBeNull();

  const extraThumb = store.put(Buffer.alloc(1, 4), 'thumb');
  const replacementFull = store.put(Buffer.alloc(3, 5), 'full');
  expect(store.get(full)).toBeNull();
  expect(store.get(thumb)).not.toBeNull();
  expect(store.get(extraThumb)).not.toBeNull();
  expect(store.get(replacementFull)).not.toBeNull();
  expect(store.size()).toBe(3);
});
