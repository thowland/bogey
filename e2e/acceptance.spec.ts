// The requirements' acceptance tests (REQUIREMENTS §15), as far as a browser under automation can
// run them, in Chromium, Firefox and WebKit, plus the export performance budget (E7, spec §9.3).
// What a person still has to do on a Mac and an iPad, Preview, Acrobat Reader and VoiceOver
// included, is in docs/manual-acceptance.md.
//
// Where an existing spec already covers a test, it is named here rather than repeated:
//
// 1. Password-protected AcroForm, every field type, a Pencil signature, a flattened export:
//    below. (fields.spec.ts covers each field type on the unprotected copy.)
// 2. A flat page within 1 pt: below, on the scanned-style page of the 20-page fixture with a saved
//    signature from the library; overlays.spec.ts compares the rendered text baseline with the
//    export at 10 and 36 pt on an upright and a rotated page.
// 3. Close mid-edit and restore: storage.spec.ts, "closing and reopening the browser restores the
//    document" (a persistent profile, closed and relaunched) and "field values and overlays come
//    back after a reload".
// 4. No requests after the shell loads, and offline use: below for the request log;
//    offline.spec.ts opens, fills, signs and downloads with the network off, and security.spec.ts
//    checks that a whole session asks only for the app's own files.
// 5. The second-form workflow under a minute: snippets.spec.ts, "open, fill from snippets, sign
//    from the library and export".
//
// Every test here runs under the violation fixture, so none takes a screenshot.
import type { Page } from '@playwright/test';
import {
  download,
  drawPenSignature,
  drawSignature,
  expect,
  fieldLayer,
  inkInBox,
  letterPoint,
  openFixture,
  pageArea,
  readExport,
  renderedPage,
  serviceWorkerReady,
  test,
  todayIn,
} from './helpers.ts';

const near = (actual: number, expected: number, what: string, within = 1) =>
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThan(within);

/** The middle half of a box, so a box's own border is left out of an ink measurement. */
const inner = ([x0, y0, x1, y1]: [number, number, number, number]) => {
  const dx = (x1 - x0) / 4;
  const dy = (y1 - y0) / 4;
  return [x0 + dx, y0 + dy, x1 - dx, y1 - dy] as [number, number, number, number];
};

/** Opens exported bytes in the app, as a user would open the downloaded copy. */
async function openExport(page: Page, bytes: Uint8Array) {
  await page.getByTestId('open-input').setInputFiles({
    name: 'export.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await renderedPage(page, 1);
}

test('1: a password-protected form, every field type and a Pencil signature, flattened @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  await drawPenSignature(page, 'Pencil');
  await openFixture(page, 'vendored/generated/acroform-all-aes256.pdf', 'bogey');
  await renderedPage(page, 1);

  const fields = fieldLayer(page);
  await fields.getByRole('textbox', { name: 'text1' }).fill('Ada Lovelace');
  await fields.getByRole('textbox', { name: 'multiline1' }).fill('First line\nSecond line');
  await fields.getByRole('textbox', { name: 'comb1' }).fill('123456789');
  await fields.getByRole('checkbox', { name: 'check1' }).check();
  await fields.getByRole('radio', { name: 'radio1: b' }).check();
  await fields.getByRole('combobox', { name: 'dropdown1' }).selectOption('Gamma');
  await fields.getByRole('listbox', { name: 'list1' }).selectOption(['Two', 'Four']);

  const { box } = await pageArea(page);
  await page.getByRole('button', { name: 'Place Pencil' }).click();
  await page.mouse.click(box.x + box.width * 0.75, box.y + 200);
  await expect(
    page.getByRole('button', { name: 'Signature overlay: Pencil, page 1', exact: true }),
  ).toBeVisible();

  // The dialog says the copy will not be password-protected (E9).
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Download a signed copy' });
  await expect(dialog).toContainText('The downloaded copy will not be.');
  const file = await download(page, () =>
    dialog.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  expect(file.name).toBe('acroform-all-aes256-signed.pdf');

  const out = await readExport(file.bytes);
  expect(out).toMatchObject({ pageCount: 1, fieldCount: 0, encrypted: false, producer: 'Bogey' });
  const words = out.text[0]!.map((item) => item.str).join(' ');
  for (const value of ['Ada Lovelace', 'First line', 'Second line', 'Gamma', 'Fixed value']) {
    expect(words, value).toContain(value);
  }
  // A comb field draws each digit in its own cell.
  expect(
    out.text[0]!.map((item) => item.str)
      .join('')
      .replace(/ /g, ''),
  ).toContain('123456789');
  expect(out.images[0], 'the signature, drawn once').toHaveLength(1);

  // The copy opens with no fields, and the box and the radio button are drawn checked.
  await openExport(page, file.bytes);
  await expect(fieldLayer(page)).toHaveCount(0);
  const checked = await inkInBox(page, 1, inner([180, 498, 194, 512]), 792);
  const radioB = await inkInBox(page, 1, inner([220, 458, 234, 472]), 792);
  const radioA = await inkInBox(page, 1, inner([180, 458, 194, 472]), 792);
  expect(checked).toBeGreaterThan(0.05);
  expect(radioB).toBeGreaterThan(radioA + 0.05);
});

test('2: a scanned page takes text, a check, a date and a saved signature within 1 pt @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  await drawSignature(page, 'Saved');
  // Saved means saved: the signature comes from the library after a reload.
  await page.reload();
  await openFixture(page, 'vendored/generated/large-20p.pdf');
  await renderedPage(page, 1);
  await page.evaluate(() => document.fonts.ready);
  // Every click stays inside the 1280 × 720 viewport, below the first-save notice.
  const { box } = await pageArea(page);
  const at = (x: number, y: number) => [box.x + x, box.y + y] as const;
  const tools = page.getByRole('group', { name: 'Tools' });

  await tools.getByRole('button', { name: /^Text/ }).click();
  await page.mouse.click(...at(150, 200));
  await page.keyboard.type('Jane Doe');
  await page.keyboard.press('Enter');
  await tools.getByRole('button', { name: /^Check/ }).click();
  await page.mouse.click(...at(220, 260));
  await tools.getByRole('button', { name: /^Date/ }).click();
  await page.mouse.click(...at(150, 320));
  const panel = page.getByRole('complementary', { name: /fields, snippets and signatures/i });
  await panel.getByRole('tab', { name: 'Signatures' }).click();
  await page.getByRole('button', { name: 'Place Saved' }).click();
  await page.mouse.click(...at(330, 420));
  await expect(
    page.getByRole('button', { name: 'Signature overlay: Saved, page 1', exact: true }),
  ).toBeVisible();

  const file = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  const out = await readExport(file.bytes);
  expect(out).toMatchObject({ pageCount: 20, fieldCount: 0, encrypted: false });
  const items = out.text[0]!;
  const find = (s: string) => items.find((item) => item.str.includes(s))!;

  // Text and dates put their baseline's left end at the click.
  for (const [text, x, y] of [
    ['Jane Doe', 150, 200],
    [todayIn('MM/DD/YYYY'), 150, 320],
  ] as const) {
    const item = find(text);
    expect(item, text).toBeDefined();
    const click = letterPoint(box, 0, { x, y });
    near(item.transform[4]!, click.x, `${text} x`);
    near(item.transform[5]!, click.y, `${text} y`);
  }

  // A check is centred on the click; its glyph starts 0.077 of its size in from the left edge.
  const check = items.find((item) => item.transform[0] === 12 && item.str !== 'Jane Doe')!;
  expect(check, 'check glyph').toBeDefined();
  const checkCentre = letterPoint(box, 0, { x: 220, y: 260 });
  near(check.transform[4]!, checkCentre.x - 6 + 0.077 * 12, 'check x');

  // The signature is centred on the click. The page's own scan is an image too, so the
  // signature is the image drawn 150 pt wide.
  const signature = out.images[0]!.find(([a]) => Math.abs(a! - 150) < 0.01)!;
  expect(signature, 'signature image').toBeDefined();
  const [a, , , d, e, f] = signature;
  const sigCentre = letterPoint(box, 0, { x: 330, y: 420 });
  near(e! + a! / 2, sigCentre.x, 'signature centre x');
  near(f! + d! / 2, sigCentre.y, 'signature centre y');
});

test('4: after the shell loads, a whole session is served without the network @all-engines', async ({
  page,
  context,
  browserName,
}) => {
  await page.goto('/');
  await serviceWorkerReady(page);
  // Reload once under the service worker, as a returning visitor would load the app.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();

  const network: string[] = [];
  let served = 0;
  context.on('requestfinished', (request) => {
    void request.response().then((response) => {
      const url = new URL(request.url());
      if (url.protocol === 'blob:' || url.protocol === 'data:') return;
      if (response?.fromServiceWorker()) served++;
      else network.push(`${request.method()} ${url.pathname}`);
    });
  });
  const failed: string[] = [];
  page.on('requestfailed', (request) => failed.push(request.url()));

  await drawSignature(page, 'Mine');
  await openFixture(page, 'vendored/generated/acroform-all.pdf');
  await renderedPage(page, 1);
  await fieldLayer(page).getByRole('textbox', { name: 'text1' }).fill('Ada Lovelace');
  const { box } = await pageArea(page);
  await page.getByRole('button', { name: 'Place Mine' }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + 120);
  await download(page, () => page.getByRole('button', { name: 'Download', exact: true }).click());
  for (const name of ['Help', 'About', 'Privacy']) {
    await page
      .getByRole('navigation', { name: 'Information' })
      .getByRole('button', { name })
      .click();
  }

  expect(failed).toEqual([]);
  expect(network, 'requests that reached the network').toEqual([]);
  expect(served, 'requests seen at all').toBeGreaterThan(0);
  console.log(`[acceptance 4] ${browserName}: ${served} requests answered by the service worker`);
});

// E7 (spec §9.3): the 20-page, 10 MB fixture downloads within the CI budget of 10 s. The spec's
// 5 s figure is for the reference laptop and is checked by hand. Open and first render times are
// measured and reported alongside.
test('E7: the 20-page, 10 MB fixture opens, renders and exports within budget @all-engines', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  const opening = Date.now();
  await openFixture(page, 'vendored/generated/large-20p.pdf');
  await renderedPage(page, 1);
  const opened = Date.now() - opening;

  const paging = Date.now();
  for (let number = 2; number <= 20; number++) {
    await page.keyboard.press(']');
    await renderedPage(page, number);
  }
  const paged = Date.now() - paging;

  const exporting = Date.now();
  const file = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  const exported = Date.now() - exporting;
  expect((await readExport(file.bytes)).pageCount).toBe(20);

  const report = `${browserName}: open and render page 1 ${opened} ms, render pages 2–20 ${paged} ms (${Math.round(paged / 19)} ms a page), export ${exported} ms`;
  test.info().annotations.push({ type: 'performance', description: report });
  console.log(`[E7] ${report}`);
  expect(exported, 'export time, ms').toBeLessThan(10_000);
});
