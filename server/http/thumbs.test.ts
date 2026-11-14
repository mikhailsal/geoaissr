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
