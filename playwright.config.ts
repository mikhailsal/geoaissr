import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './web/tests',
  globalSetup: './web/tests/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
