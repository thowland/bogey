import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';
import { ports } from './scripts/ports.mjs';

type Engine = 'chromium' | 'firefox' | 'webkit';
const ENGINES: Engine[] = ['chromium', 'firefox', 'webkit'];
// Each checkout gets its own browser-mode server port so worktrees can test concurrently
// (implementation plan §1.4); engines in one run share it.
const BROWSER_API = { port: ports().vitest, strictPort: false };

/** One browser-mode project per engine. Only Chromium feeds v8 coverage (implementation plan §1.3). */
function browserProjects(
  name: string,
  include: string[],
  app?: { extends: string; root: string },
): TestProjectConfiguration[] {
  return ENGINES.map((engine) => ({
    ...(app ? { extends: app.extends } : {}),
    test: {
      name: `${name}:${engine}`,
      ...(app ? { root: app.root } : {}),
      include,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: engine }],
        screenshotFailures: false,
        api: BROWSER_API,
      },
    },
  }));
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core:node',
          include: ['packages/core/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      ...browserProjects('core', ['packages/core/test/**/*.test.ts']),
      {
        extends: './apps/web/vite.config.ts',
        test: {
          name: 'web:jsdom',
          root: './apps/web',
          include: ['test/**/*.test.{ts,tsx}'],
          exclude: ['test/**/*.browser.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./test/setup.ts'],
        },
      },
      // Tests that need a real browser: canvas, IndexedDB, pdf.js rendering, pointer events.
      ...browserProjects('web', ['test/**/*.browser.test.{ts,tsx}'], {
        extends: './apps/web/vite.config.ts',
        root: './apps/web',
      }),
      {
        test: {
          name: 'tooling:node',
          include: ['tooling/test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        // Documented exclusions (implementation plan §1.3): entry-point glue that only runs
        // when the real app boots in a browser. Keep this list short and justify every entry.
        'apps/web/src/main.tsx', // React root mount; exercised by the production build and E2E.
      ],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
