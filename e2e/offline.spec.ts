// Offline use and updates (spec §11.5, S8, B7, acceptance 4). After one visit the service worker
// holds the whole app, so with the network off the page reloads, opens a PDF, fills it, signs it
// and downloads the copy, with the pdf.js worker, the pdf worker, fonts and WASM all served from
// the cache under the production headers. Then a second build is deployed to a server the test
// controls: the page offers the update, and accepting it reloads into the new build. The kill
// switch purges the worker and its caches.
//
// WebKit stands in for the iPad here; the real-device check (airplane mode on the iPad) is the
// maintainer's review step.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { previewHeaders as headers } from '../apps/web/security/headers.ts';
import { KILL_SWITCH_SOURCE } from '../scripts/sw-kill.ts';
import {
  download,
  drawSignature,
  expect,
  fieldLayer,
  openFixture,
  pageArea,
  readExport,
  renderedPage,
  serviceWorkerReady,
  test,
} from './helpers.ts';

test('offline after the first visit: reload, open, fill, sign and download @all-engines', async ({
  page,
  context,
}) => {
  const failed: string[] = [];
  page.on('requestfailed', (request) =>
    failed.push(`${request.url()} ${request.failure()?.errorText}`),
  );

  await page.goto('/');
  await serviceWorkerReady(page);
  await context.setOffline(true);

  await page.reload();
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
  await drawSignature(page, 'Offline');
  await openFixture(page, 'vendored/generated/acroform-all.pdf');
  await renderedPage(page, 1);
  await fieldLayer(page).getByRole('textbox', { name: 'text1' }).fill('Written offline');
  await fieldLayer(page).getByRole('checkbox', { name: 'check1' }).check();
  const { box } = await pageArea(page);
  await page.getByRole('button', { name: 'Place Offline' }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + 120);

  const file = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  const out = await readExport(file.bytes);
  expect(out).toMatchObject({ pageCount: 1, fieldCount: 0, encrypted: false });
  expect(out.text[0]!.map((item) => item.str).join(' ')).toContain('Written offline');
  expect(out.images[0]).toHaveLength(1);
  expect(failed).toEqual([]);
});

// ── a server the test controls, for deploying a second build ──

const dist = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

interface Site {
  url: string;
  /** The directory served; switching it is a deploy. */
  root: string;
  /** Files served in place of the build's, by path. */
  overrides: Map<string, string>;
  close(): Promise<void>;
}

/** Serves a build like `vite preview`: the production headers, index.html for unknown paths. */
async function site(root: string): Promise<Site> {
  const state = { root, overrides: new Map<string, string>() };
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.setHeader('Cache-Control', 'no-cache');
    const override = state.overrides.get(path);
    if (override !== undefined) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(override);
      return;
    }
    let file = join(state.root, normalize(path));
    if (!file.startsWith(state.root) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      file = join(state.root, 'index.html');
    }
    response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}`,
    get root() {
      return state.root;
    },
    set root(next: string) {
      state.root = next;
    },
    overrides: state.overrides,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** The build id the About page shows. */
async function shownBuild(page: Page): Promise<string> {
  await page
    .getByRole('navigation', { name: 'Information' })
    .getByRole('button', { name: 'About' })
    .click();
  const build = (await page.locator('dd code').textContent()) ?? '';
  await page
    .getByRole('navigation', { name: 'Information' })
    .getByRole('button', { name: 'About' })
    .click();
  return build;
}

const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

test.describe('updates and the kill switch', () => {
  let second: string;

  test.beforeAll(() => {
    // A second build of the same commit with its own build id: new hashes, a new cache name.
    second = mkdtempSync(join(tmpdir(), 'bogey-second-build-'));
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@bogey/web',
        'exec',
        'vite',
        'build',
        '--outDir',
        second,
        '--emptyOutDir',
        '--logLevel',
        'error',
      ],
      { env: { ...process.env, VITE_BOGEY_BUILD: 'e2e-second' }, stdio: 'inherit' },
    );
  });

  test.afterAll(() => rmSync(second, { recursive: true, force: true }));

  test('a new build is offered, and accepting it reloads into the new version', async ({
    page,
  }) => {
    const server = await site(dist);
    try {
      await page.goto(server.url);
      await serviceWorkerReady(page);
      const first = await shownBuild(page);
      const [firstCache] = await cacheNames(page);
      expect(first).not.toBe('e2e-second');

      server.root = second;
      await page.reload();
      // The old worker still serves the old build until the user accepts.
      expect(await shownBuild(page)).toBe(first);
      const toast = page
        .getByRole('status')
        .filter({ hasText: 'A new version is ready. Reload to update.' });
      await expect(toast).toBeVisible();

      await toast.getByRole('button', { name: 'Reload' }).click();
      await expect.poll(() => shownBuild(page)).toBe('e2e-second');
      const caches = await cacheNames(page);
      expect(caches).toHaveLength(1);
      expect(caches[0]).toMatch(/^bogey-e2e-second-/);
      expect(caches[0]).not.toBe(firstCache);
      await expect(page.getByText('A new version is ready.')).toBeHidden();
    } finally {
      await server.close();
    }
  });

  test('the kill switch deletes the caches and stops serving from them', async ({ page }) => {
    const server = await site(dist);
    try {
      await page.goto(server.url);
      await serviceWorkerReady(page);
      expect(await cacheNames(page)).toHaveLength(1);

      server.overrides.set('/sw.js', KILL_SWITCH_SOURCE);
      await page.reload();
      // The kill switch reloads the page as it takes over, so a check may hit a navigation.
      await expect.poll(() => cacheNames(page).catch(() => null)).toEqual([]);

      // The app still loads, and nothing comes from a cache any more. While the kill switch is
      // deployed the app re-registers it on each load; it has no fetch handler.
      const fromWorker: string[] = [];
      page.on('response', (response) => {
        if (response.fromServiceWorker()) fromWorker.push(response.url());
      });
      await page.reload();
      await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
      expect(fromWorker).toEqual([]);
      expect(await cacheNames(page)).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
