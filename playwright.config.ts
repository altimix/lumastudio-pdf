import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'chrome',
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5193',
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.CI ? {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5193',
    timeout: 60_000,
    reuseExistingServer: false,
  } : undefined,
});
