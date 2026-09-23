import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Each project owns a separate browser worker. Keep long PDF and font
  // workflows in fresh browser processes on shared Windows CI runners.
  projects: [
    { name: 'pdf-workflows', testMatch: /(?:ai-settings|certificate-guide|direct-edit|editor|font-rendering|merge)\.spec\.ts$/ },
    { name: 'numeric-fields', testMatch: /numeric-field\.spec\.ts$/ },
    { name: 'editable-projects', testMatch: /project\.spec\.ts$/ },
    { name: 'shape-geometry', testMatch: /shape-geometry\.spec\.ts$/ },
    { name: 'signature-and-typography', testMatch: /(?:signature|typography)\.spec\.ts$/ },
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
