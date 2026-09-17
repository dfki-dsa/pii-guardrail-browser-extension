import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: __dirname,
  testMatch: /(?:local|extension|onboarding)-harness\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 800 },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
