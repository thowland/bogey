// End-to-end tests (implementation plan G4): the production build, served by `vite preview` with
// the production header set (apps/web/security/headers.json). Chromium runs every spec; Firefox
// and WebKit run the specs tagged @all-engines. Ports come from scripts/ports.mjs so concurrent
// worktrees do not collide (implementation plan §1.4).
import { defineConfig, devices } from '@playwright/test';
import { ports } from './scripts/ports.mjs';

const PORT = ports().e2e;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // One worker: the suite shares one preview server and measures real rendering.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    // The build must exist; `pnpm gate` builds before running the suite.
    command: `pnpm --filter @bogey/web exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@all-engines/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@all-engines/ },
  ],
});
