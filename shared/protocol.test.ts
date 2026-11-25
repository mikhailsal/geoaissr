import { expect, test } from 'bun:test';
import { lobbySettingsPatchSchema } from './protocol.ts';
import { PUSH_SECONDS_MAX, PUSH_SECONDS_MIN } from './storage-schemas.ts';

test('lobby push seconds accepts integer bounds and rejects invalid values', () => {
  expect(lobbySettingsPatchSchema.parse({ pushSeconds: PUSH_SECONDS_MIN })).toEqual({
    pushSeconds: PUSH_SECONDS_MIN,
  });
  expect(lobbySettingsPatchSchema.parse({ pushSeconds: PUSH_SECONDS_MAX })).toEqual({
    pushSeconds: PUSH_SECONDS_MAX,
  });
  expect(lobbySettingsPatchSchema.safeParse({ pushSeconds: PUSH_SECONDS_MIN - 1 }).success).toBe(
    false,
  );
  expect(lobbySettingsPatchSchema.safeParse({ pushSeconds: PUSH_SECONDS_MAX + 1 }).success).toBe(
    false,
  );
  expect(lobbySettingsPatchSchema.safeParse({ pushSeconds: 1.5 }).success).toBe(false);
});
