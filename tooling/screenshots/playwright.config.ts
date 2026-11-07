// README screenshots (`pnpm screenshots`): the production build, driven through the IRS W-9 and
// W-4 with an imaginary taxpayer, written to docs/images/. Not part of the gate.
import { defineConfig, devices } from '@playwright/test';
import { ports } from '../../scripts/ports.mjs';

const PORT = ports().e2e;

export default defineConfig({
  testDir: '.',
  testMatch: '*.shots.ts',
  outputDir: '../../test-results/screenshots',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  forbidOnly: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, acceptDownloads: true },
  webServer: {
    command: `pnpm --filter @bogey/web exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
      grep: /@desktop/,
    },
    { name: 'ipad', use: { ...devices['iPad Pro 11 landscape'] }, grep: /@ipad/ },
  ],
});
