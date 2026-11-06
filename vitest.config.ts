import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';
import { ports } from './scripts/ports.mjs';

type Engine = 'chromium' | 'firefox' | 'webkit';
const ENGINES: Engine[] = ['chromium', 'firefox', 'webkit'];
// Each checkout gets its own browser-mode server port so worktrees can test concurrently
// (implementation plan §1.4); engines in one run share it.
const BROWSER_API = { port: ports().vitest, strictPort: false };

// Dependencies the browser-mode tests import, pre-bundled up front. Left to discovery, Vite finds
// them partway through a run on a cold cache, re-optimizes and reloads the page, which loads React
// twice and fails test imports; the gate on master after a merge always starts cold for new
// imports. Add a package here when a browser test (or code it loads) starts importing it.
const CORE_BROWSER_DEPS = ['@cantoo/pdf-lib', 'zod', 'fast-check'];
const WEB_BROWSER_DEPS = [
  'react',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'zustand',
  'idb',
  'comlink',
  'pdfjs-dist',
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@testing-library/react',
  '@testing-library/user-event',
  'fast-check',
  '@bogey/core > @cantoo/pdf-lib',
  '@bogey/core > zod',
];

/** One browser-mode project per engine. Only Chromium feeds v8 coverage (implementation plan §1.3). */
function browserProjects(
  name: string,
  options: { root: string; include: string[]; deps: string[]; extends?: string },
): TestProjectConfiguration[] {
  return ENGINES.map((engine) => ({
    ...(options.extends ? { extends: options.extends } : {}),
    optimizeDeps: { include: options.deps },
    test: {
      name: `${name}:${engine}`,
      root: options.root,
      include: options.include,
      api: BROWSER_API,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: engine }],
        screenshotFailures: false,
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
      ...browserProjects('core', {
        root: './packages/core',
        include: ['test/**/*.test.ts'],
        deps: CORE_BROWSER_DEPS,
      }),
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
      ...browserProjects('web', {
        extends: './apps/web/vite.config.ts',
        root: './apps/web',
        include: ['test/**/*.browser.test.{ts,tsx}'],
        deps: WEB_BROWSER_DEPS,
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
        // The pdf worker's bootstrap line (expose); its API is tested in workers/pdfWorkerApi.ts.
        'apps/web/src/workers/pdf.worker.ts',
      ],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
