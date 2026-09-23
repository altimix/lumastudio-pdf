import { defineConfig, devices } from '@playwright/test';

const ci = !!process.env.CI;
const previewURL = 'http://127.0.0.1:5193';
const sourceURL = ci ? 'http://127.0.0.1:5195' : (process.env.PLAYWRIGHT_BASE_URL || previewURL);

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Each project owns a separate browser worker. Keep long PDF and font
  // workflows in fresh browser processes on shared Windows CI runners.
  projects: [
    { name: 'pdf-workflows', testMatch: /(?:ai-settings|certificate-guide|direct-edit|editable-copy|editor|ink-tools|menu-panel|merge|thumbnail-layout|window-restore)\.spec\.ts$/ },
    { name: 'font-rendering', testMatch: /font-rendering\.spec\.ts$/, use: { baseURL: sourceURL } },
    { name: 'numeric-fields', testMatch: /numeric-field\.spec\.ts$/ },
    { name: 'editable-projects', testMatch: /project\.spec\.ts$/ },
    { name: 'shape-geometry', testMatch: /shape-geometry\.spec\.ts$/ },
    { name: 'signature', testMatch: /signature\.spec\.ts$/ },
    { name: 'typography', testMatch: /typography\.spec\.ts$/, use: { baseURL: sourceURL } },
  ],
  // Shared CI Windows hosts can stall during font/worker decoding and tracing.
  // Normal UI assertions remain 10s; only explicit loading waits use 30s.
  timeout: ci ? 90_000 : 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    channel: ci ? undefined : 'chrome',
    baseURL: process.env.PLAYWRIGHT_BASE_URL || previewURL,
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: ci ? {
    command: 'node scripts/e2e-ci-server.mjs',
    url: previewURL,
    timeout: 60_000,
    reuseExistingServer: false,
  } : undefined,
});
