import { expect, test } from 'bun:test';
import { runPool } from './pool.ts';

function trackedJobs(count: number): {
  jobs: (() => Promise<number>)[];
  peak: () => number;
} {
  let inFlight = 0;
  let peak = 0;
  const jobs = Array.from({ length: count }, (_, i) => async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5 - (i % 3)));
    inFlight -= 1;
    return i;
  });
  return { jobs, peak: () => peak };
}

// Value: protects=eval jobs run at most `concurrency` at a time and results keep job order; fails_when=the cap is ignored or results are ordered by completion; why_new=pool.ts had no direct test; seam=none; no_claim=real harness timing (timer-based fake jobs).
test('runPool honours the concurrency cap and keeps results in job order', async () => {
  const { jobs, peak } = trackedJobs(7);
  const results = await runPool(jobs, 3);
  expect(results).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(peak()).toBe(3);
});

// Value: protects=a stop signal (infra error or abort) skips jobs that have not started; fails_when=queued rounds still launch after shouldStop turns true; why_new=only the CLI fails fast on one spot; seam=none; no_claim=cancelling a job already running.
test('runPool skips jobs that have not started once shouldStop turns true', async () => {
  let stop = false;
  const started: number[] = [];
  const jobs = [0, 1, 2, 3].map((i) => async () => {
    started.push(i);
    await Promise.resolve();
    if (i === 1) stop = true;
    return i;
  });
  const results = await runPool(jobs, 1, () => stop);
  expect(started).toEqual([0, 1]);
  expect(results).toEqual([0, 1, undefined, undefined]);
});

// Value: protects=a job that throws stops new rounds and the pool rejects only after running jobs settle; fails_when=other workers keep launching paid rounds after a failure or the caller cleans up under a running job; why_new=only stop and order were tested; seam=none; no_claim=cancelling the running job.
test('runPool stops starting jobs after a failure and rejects once running jobs settle', async () => {
  const started: number[] = [];
  let slowDone = false;
  const jobs = [0, 1, 2, 3, 4].map((i) => async () => {
    started.push(i);
    if (i === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      slowDone = true;
      return i;
    }
    if (i === 1) throw new Error('boom');
    return i;
  });
  const error = await runPool(jobs, 2).then(
    () => null,
    (err: unknown) => err,
  );
  expect(error instanceof Error ? error.message : null).toBe('boom');
  expect(slowDone).toBe(true);
  expect(started).toEqual([0, 1]);
});
