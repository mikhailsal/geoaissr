import { defineConfig } from '@playwright/test';

// Every test starts its own fake server on port 0 with its own data dir
// (`web/tests/helpers.ts`), so files run side by side. CI runs 3 shards with 2 workers each;
// locally Playwright uses half the cores. `PW_WORKERS` overrides both.
function workerCount(): number | string {
  const fromEnv = process.env.PW_WORKERS;
  if (fromEnv !== undefined) return fromEnv.endsWith('%') ? fromEnv : Number(fromEnv);
  return process.env.CI ? 2 : '50%';
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
