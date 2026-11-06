import { expect, test } from './helpers.ts';

// Self-test for the violation collector every test relies on: a blocked script must be caught,
// which makes this test fail as expected (it shows as ✘ but counts as passing).
test('the violation collector catches a Trusted Types violation', async ({ page }) => {
  test.fail();
  await page.goto('/');
  await page.evaluate(() => {
    try {
      const script = document.createElement('script');
      script.textContent = 'void 0';
      document.head.append(script);
    } catch {
      // Trusted Types throws; the violation is still reported.
    }
  });
  await expect(page.getByText('Bogey', { exact: true })).toBeVisible();
});

test('a URL with a query or hash still opens the plain empty app (spec §11.2)', async ({
  page,
}) => {
  await page.goto('/?open=https://evil.example/form.pdf#doc=1');
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
});

// The framing page is a separate page outside the violation collector: the refusal is reported as
// a frame-ancestors violation in that page's console, which is the expected outcome here.
test('the page refuses to be framed (spec §11.3)', async ({ browser, baseURL }) => {
  const attacker = await browser.newPage();
  await attacker.setContent(`<iframe id="target" src="${baseURL}/"></iframe>`);
  await attacker.waitForTimeout(1500);
  const frame = attacker.frames().find((f) => f !== attacker.mainFrame());
  const text = frame
    ? await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    : '';
  expect(text).not.toContain('Bogey');
  await attacker.close();
});

// Native <select> stays (spec §16.4): WebKit's report about its own control is ignored, and nothing
// else is. The second test proves a style attribute the page sets is still caught in every engine.
test('a native select raises no violation @all-engines', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const select = document.createElement('select');
    select.append(new Option('One'), new Option('Two'));
    document.body.append(select);
  });
  await expect(page.getByRole('combobox')).toBeVisible();
});

test('a style attribute set by the page is still caught @all-engines', async ({ page }) => {
  test.fail();
  await page.goto('/');
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.setAttribute('style', 'color: red');
    document.body.append(div);
  });
  await page.waitForTimeout(300);
});

// ── Sprint 9: the security suite (spec §11, §14.5) ──

import type { BrowserContext, Page } from '@playwright/test';
import {
  activeContent,
  buildPaths,
  download,
  drawSignature,
  fieldLayer,
  fixture,
  openFixture,
  pageArea,
  readExport,
  renderedPage,
  savedRecords,
  serviceWorkerReady,
  waitForSaved,
} from './helpers.ts';

/** Every request the context makes (pages, workers and the service worker), as `METHOD url`. */
function recordRequests(context: BrowserContext): { method: string; url: string }[] {
  const requests: { method: string; url: string }[] = [];
  context.on('request', (request) =>
    requests.push({ method: request.method(), url: request.url() }),
  );
  return requests;
}

/**
 * Requests outside the allow-list (S1, T9): anything but a GET to this origin for `/`, a path the
 * build publishes, or a path under /pdfjs/. blob: and data: URLs never leave the browser.
 */
function disallowed(requests: { method: string; url: string }[], origin: string): string[] {
  const published = buildPaths();
  return requests
    .filter(({ method, url }) => {
      const parsed = new URL(url);
      if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return false;
      if (method !== 'GET' || parsed.origin !== origin) return true;
      const path = parsed.pathname;
      return !(path === '/' || published.has(path) || path.startsWith('/pdfjs/'));
    })
    .map(({ method, url }) => `${method} ${url}`);
}

/**
 * Anything a document or another window could make the app do that it must not: dialogs, new
 * windows, navigations of the app's own page. Start watching after the test's own first load.
 */
function watchSideEffects(page: Page, context: BrowserContext) {
  const effects: string[] = [];
  page.on('dialog', (dialog) => {
    effects.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  context.on('page', (opened) => effects.push(`window opened: ${opened.url()}`));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) effects.push(`navigated: ${frame.url()}`);
  });
  return effects;
}

/**
 * A saved record's field values as [name, value] pairs, read in the page: a plain object would
 * lose an own `__proto__` key on its way out of the page.
 */
function savedFieldEntries(page: Page, id: string): Promise<[string, unknown][]> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('bogey');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('open failed'));
    });
    try {
      const record = await new Promise<{ fieldValues: object } | undefined>((resolve, reject) => {
        const request = db.transaction('documents').objectStore('documents').get(id);
        request.onsuccess = () => resolve(request.result as { fieldValues: object } | undefined);
        request.onerror = () => reject(request.error ?? new Error('read failed'));
      });
      return record
        ? Object.entries(record.fieldValues).sort(([a], [b]) => a.localeCompare(b))
        : [];
    } finally {
      db.close();
    }
  }, id);
}

test('a full session requests only GETs for published paths and /pdfjs/ (S1, T9)', async ({
  page,
  context,
  baseURL,
}) => {
  const requests = recordRequests(context);
  await page.goto('/');
  await serviceWorkerReady(page);
  await drawSignature(page, 'Mine');
  await openFixture(page, 'vendored/generated/acroform-all.pdf');
  await renderedPage(page, 1);
  await fieldLayer(page).getByRole('textbox', { name: 'text1' }).fill('Ada Lovelace');
  await fieldLayer(page).getByRole('checkbox', { name: 'check1' }).check();
  const { box } = await pageArea(page);
  await page.getByRole('button', { name: 'Place Mine' }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + 120);
  await waitForSaved(page, 'acroform-all.pdf');
  await download(page, () => page.getByRole('button', { name: 'Download', exact: true }).click());
  await page.reload();
  await renderedPage(page, 1);
  for (const name of ['Help', 'About', 'Privacy']) {
    await page
      .getByRole('navigation', { name: 'Information' })
      .getByRole('button', { name })
      .click();
  }

  expect(requests.length).toBeGreaterThan(10);
  expect(requests.some(({ url }) => url.includes('/pdfjs/'))).toBe(true);
  expect(disallowed(requests, new URL(baseURL!).origin)).toEqual([]);
});

test('arbitrary paths, queries and hashes load the plain app and nothing else (T1)', async ({
  page,
  context,
  baseURL,
}) => {
  const requests = recordRequests(context);
  for (const path of [
    '/forms/w9.pdf?open=https://evil.example/form.pdf',
    '/#open=https://evil.example/form.pdf&sign=1',
    '/?file=data:application/pdf;base64,JVBERi0=#page=2',
    '/index.html?open=/pdfjs/standard_fonts/FoxitSerif.pfb',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
    await expect(page.locator('[data-page]')).toHaveCount(0);
  }
  expect(
    requests.filter(({ url }) => new URL(url).hostname !== new URL(baseURL!).hostname),
  ).toEqual([]);
  // Unknown paths load the app shell; nothing else is fetched for them.
  expect(
    disallowed(
      requests.filter(
        ({ url }) => !/\/(forms\/w9\.pdf|index\.html)(\?|$)/.test(new URL(url).pathname),
      ),
      new URL(baseURL!).origin,
    ),
  ).toEqual([]);
});

test('a link to the app with a query opens the saved session and nothing else (T1)', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/flat-single.pdf');
  await renderedPage(page, 1);
  await waitForSaved(page, 'flat-single.pdf');
  await page.goto('/?open=https://evil.example/form.pdf#doc=other');
  await renderedPage(page, 1);
  expect((await savedRecords(page)).map((record) => record.name)).toEqual(['flat-single.pdf']);
});

test('messages from another window are ignored (T2)', async ({ page, context, baseURL }) => {
  await page.goto('/');
  const effects = watchSideEffects(page, context);
  const pdf = [...fixture('vendored/generated/flat-single.pdf')];

  // From the page's own window, as any script in another frame would: files, URLs and commands.
  await page.evaluate((bytes) => {
    const buffer = new Uint8Array(bytes).buffer;
    const file = new File([buffer], 'injected.pdf', { type: 'application/pdf' });
    for (const message of [
      buffer,
      file,
      { type: 'open', url: '/pdfjs/standard_fonts/FoxitSerif.pfb' },
      { type: 'open', file },
      { action: 'export' },
      'open',
    ]) {
      window.postMessage(message, '*');
    }
  }, pdf);

  // From another page that opens the app and keeps the handle: once the app loads, COOP has cut
  // the handle off, so there is nothing left to post to.
  type Attacker = Window & { target?: Window | null };
  const attacker = await context.newPage();
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    attacker.evaluate((url) => {
      // The attacker's page, not Bogey's, opens the app.
      // eslint-disable-next-line no-restricted-syntax
      (window as Attacker).target = window.open(url);
    }, baseURL!),
  ]);
  await expect(popup.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
  const severed = await attacker.evaluate(() => {
    const target = (window as Attacker).target;
    try {
      target?.postMessage({ type: 'open', url: '/evil.pdf' }, '*');
    } catch {
      // A severed handle may throw; either way nothing reaches the app.
    }
    return !target || target.closed;
  });
  expect(severed).toBe(true);
  await expect(popup.locator('[data-page]')).toHaveCount(0);
  await popup.close();
  await attacker.close();

  await page.waitForTimeout(500);
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
  await expect(page.locator('[data-page]')).toHaveCount(0);
  expect(effects.filter((effect) => !effect.startsWith('window opened'))).toEqual([]);
});

test('a dragged link or HTML is ignored, on the drop zone and elsewhere @all-engines', async ({
  page,
  context,
}) => {
  const requests = recordRequests(context);
  await page.goto('/');
  const effects = watchSideEffects(page, context);
  const before = requests.length;
  for (const target of ['[aria-label="Open a PDF"]', 'header']) {
    const dataTransfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.setData('text/uri-list', 'https://evil.example/form.pdf');
      data.setData('text/plain', 'https://evil.example/form.pdf');
      data.setData('text/html', '<a href="https://evil.example/form.pdf">form</a>');
      return data;
    });
    for (const type of ['dragenter', 'dragover', 'drop']) {
      await page.dispatchEvent(target, type, { dataTransfer });
    }
  }
  await page.waitForTimeout(300);
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-page]')).toHaveCount(0);
  expect(
    requests.slice(before).filter(({ url }) => new URL(url).hostname === 'evil.example'),
  ).toEqual([]);
  expect(effects).toEqual([]);
});

test('a hostile PDF runs nothing, navigates nowhere and exports without its actions (T3) @all-engines', async ({
  page,
  context,
  baseURL,
}) => {
  const source = fixture('vendored/generated/hostile-actions.pdf');
  const planted = (await activeContent(source)).join('\n');
  for (const kind of [
    '/S /JavaScript',
    '/S /Launch',
    '/S /SubmitForm',
    'javascript: URI',
    '/OpenAction',
    '/AA',
    'link with an action',
  ]) {
    expect(planted, `the fixture plants ${kind}`).toContain(kind);
  }

  const requests = recordRequests(context);
  await page.goto('/');
  const effects = watchSideEffects(page, context);
  const prototypeBefore = await page.evaluate(() =>
    Object.getOwnPropertyNames(Object.prototype).sort(),
  );
  await openFixture(page, 'vendored/generated/hostile-actions.pdf');
  await renderedPage(page, 1);

  // Click each link and the submit button where the page draws them.
  const { box } = await pageArea(page);
  const k = box.width / 612;
  for (const [x, y] of [
    [150, 612],
    [150, 552],
    [220, 411],
  ] as const) {
    await page.mouse.click(box.x + x * k, box.y + (792 - y) * k);
  }

  // A field named __proto__ is an ordinary field: it fills, saves, restores and exports.
  const fields = fieldLayer(page);
  await fields.getByRole('textbox', { name: '__proto__', exact: true }).fill('Proto value');
  await fields.getByRole('textbox', { name: 'name', exact: true }).fill('Ada Lovelace');
  const record = await waitForSaved(page, 'hostile-actions.pdf');
  await expect
    .poll(() => savedFieldEntries(page, record.id))
    .toEqual([
      ['__proto__', 'Proto value'],
      ['name', 'Ada Lovelace'],
    ]);
  expect(await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype).sort())).toEqual(
    prototypeBefore,
  );
  await page.reload();
  await renderedPage(page, 1);
  await expect(
    fieldLayer(page).getByRole('textbox', { name: '__proto__', exact: true }),
  ).toHaveValue('Proto value');

  const file = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  // Checked over every object reachable from the trailer, which is everything a reader acts on.
  // pdf-lib also writes the stripped action objects back out, unreferenced; removing those is a
  // core export change (reported in the Sprint 9 merge, not made here).
  expect(await activeContent(file.bytes)).toEqual([]);
  const out = await readExport(file.bytes);
  expect(out).toMatchObject({ pageCount: 1, fieldCount: 0, encrypted: false });
  const text = out.text[0]!.map((item) => item.str).join(' ');
  expect(text).toContain('Proto value');
  expect(text).toContain('Ada Lovelace');

  // The reload above is the only navigation.
  expect(effects).toEqual([`navigated: ${baseURL}/`]);
  expect(disallowed(requests, new URL(baseURL!).origin)).toEqual([]);
});

test('files renamed to .pdf are refused, whatever they contain (D1, T3)', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const effects = watchSideEffects(page, context);
  for (const [name, contents] of [
    ['invoice.pdf', '<!doctype html><script>alert("ran")</script><img src=x onerror=alert(1)>'],
    ['scan.pdf', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('latin1')],
    ['late-header.pdf', `${' '.repeat(2048)}%PDF-1.7\n`],
    ['empty.pdf', ''],
  ] as const) {
    await page.getByTestId('open-input').setInputFiles({
      name,
      mimeType: 'application/pdf',
      buffer: Buffer.from(contents, 'latin1'),
    });
    await expect(page.getByRole('alert')).toContainText('not a PDF');
  }
  await expect(page.locator('[data-page]')).toHaveCount(0);
  expect(effects).toEqual([]);
});
