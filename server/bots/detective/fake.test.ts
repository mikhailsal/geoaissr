import { expect, test } from 'bun:test';
import { runFakeBrain } from './fake.ts';
import type { DetectiveRun } from './run.ts';
import { TARGET, makeSession } from './test-helpers.ts';

// Value: protects=the fake brain cannot starve the server of its event loop; fails_when=an error reply from briefing, which comes back without a wait, is retried in a loop; why_new=the loop only ended on a report or on the round end; seam=none; no_claim=the scripted asks, covered by the Playwright lane.
test('the fake brain stops asking for the report at an error reply and sends its guess', async () => {
  const { session, log } = makeSession();
  // The eyes are gone before the brain starts: briefing answers at once with an error.
  session.eyesExited();
  const calls: string[] = [];
  const counted: typeof session = {
    ...session,
    call: (role, tool, args) => {
      calls.push(tool);
      // A loop would never give the test runner a turn; fail instead of hanging.
      if (calls.length > 20) throw new Error('the fake brain keeps calling tools');
      return session.call(role, tool, args);
    },
  };
  const run = {
    session: counted,
    params: { target: TARGET, slot: { personalityPreset: 'neutral' } },
    canMove: false,
  } as unknown as DetectiveRun;
  expect(await runFakeBrain(run, 0)).toBe(true);
  expect(calls).toEqual(['briefing', 'final_guess']);
  expect(log.guesses.map((g) => g.finalized)).toEqual([true]);
});
