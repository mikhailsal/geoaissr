import { expect, test } from 'bun:test';
import { clientMessageSchema, lobbySettingsPatchSchema } from './protocol.ts';
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

// Value: protects=the wire accepts ready_next with the next_round shape and rejects a missing or
// zero round number; fails_when=the enum drops ready_next, or ready_next stops needing roundNumber;
// why_new=no test parsed next_round or ready_next messages; seam=none;
// no_claim=server forwarding (ws-actions, exercised by web/tests/ready-next.spec.ts).
test('ready_next parses like next_round and needs a positive round number', () => {
  for (const type of ['next_round', 'ready_next']) {
    expect(clientMessageSchema.safeParse({ type, seq: 1, roundNumber: 2 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type, seq: 1 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type, seq: 1, roundNumber: 0 }).success).toBe(false);
  }
});
