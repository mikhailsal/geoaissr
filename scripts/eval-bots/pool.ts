/**
 * Runs `jobs` with at most `concurrency` in flight; results keep job order.
 * A job that has not started when `shouldStop()` turns true is skipped (its slot stays undefined).
 * A job that throws stops new jobs from starting; the pool waits for the jobs already running,
 * then rethrows the first error, so the caller never cleans up under a running job.
 */
export async function runPool<T>(
  jobs: readonly (() => Promise<T>)[],
  concurrency: number,
  shouldStop: () => boolean = () => false,
): Promise<(T | undefined)[]> {
  const results: (T | undefined)[] = new Array<T | undefined>(jobs.length).fill(undefined);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !failed && !shouldStop()) {
      const idx = next;
      next += 1;
      const job = jobs[idx];
      if (!job) continue;
      try {
        results[idx] = await job();
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  );
  const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (rejected) {
    const reason: unknown = rejected.reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  return results;
}
