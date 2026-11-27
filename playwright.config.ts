import { defineConfig } from '@playwright/test';

// Every test starts its own fake server on port 0 with its own data dir
// (`web/tests/helpers.ts`), so files run side by side: 2 workers, locally and in each of the 3 CI
// shards. More workers slow the long match tests past their 45 s deadline on an 8-core machine.
// `PW_WORKERS` overrides the count (a number or a percentage of the cores).
function workerCount(): number | string {
  const fromEnv = process.env.PW_WORKERS;
  if (fromEnv !== undefined) return fromEnv.endsWith('%') ? fromEnv : Number(fromEnv);
  return 2;
}

export default defineConfig({
  testDir: './web/tests',
  globalSetup: './web/tests/global-setup.ts',
  fullyParallel: false,
  workers: workerCount(),
  // Flaky tests are fixed, not retried: a retry would hide them.
  retries: 0,
  timeout: 45_000,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
