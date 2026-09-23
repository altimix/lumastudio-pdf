import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Each project owns a separate browser worker. Windows runners can retain
  // hundreds of decoded CJK font faces across contexts within one browser;
  // start the material tests with a fresh process while keeping all 47 cases.
  projects: [
    { name: 'pdf-workflows', testMatch: /(?:ai-settings|certificate-guide|direct-edit|editor|font-rendering|merge)\.spec\.ts$/ },
    { name: 'material-editor', testMatch: /(?:numeric-field|project|shape-geometry|signature|typography)\.spec\.ts$/ },
  ],
  // Shared CI Windows hosts can stall during font/worker decoding and tracing.
  // Normal UI assertions remain 10s; only explicit loading waits use 30s.
  timeout: process.env.CI ? 90_000 : 45_000,
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
