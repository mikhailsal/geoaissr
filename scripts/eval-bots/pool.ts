/**
 * Runs `jobs` with at most `concurrency` in flight; results keep job order.
 * A job that has not started when `shouldStop()` turns true is skipped (its slot stays undefined).
 */
export async function runPool<T>(
  jobs: readonly (() => Promise<T>)[],
  concurrency: number,
  shouldStop: () => boolean = () => false,
): Promise<(T | undefined)[]> {
  const results: (T | undefined)[] = new Array<T | undefined>(jobs.length).fill(undefined);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !shouldStop()) {
      const idx = next;
      next += 1;
      const job = jobs[idx];
      if (job) results[idx] = await job();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}
