// The viewer under the production headers (Sprint 1): opening, rendering, paging, zoom and the
// password flow. The violation fixture fails any test that raises a CSP or Trusted Types report.
import { existsSync, readFileSync } from 'node:fs';
import { expect, inkCoverage, openFixture, renderedPage, test } from './helpers.ts';

test('a flat PDF opens and renders @all-engines', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/flat-single.pdf');
  await renderedPage(page, 1);
  expect(await inkCoverage(page, 1)).toBeGreaterThan(0);
});

test('JBIG2 and JPEG 2000 images decode with the WASM decoders @all-engines', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'fetched/pdfjs/issue3371.pdf', 'ELXRTQWS');
  await renderedPage(page, 1);
  expect(await inkCoverage(page, 1)).toBeGreaterThan(0);
});

test('embedded fonts and ICC colour load without violations @all-engines', async ({ page }) => {
  await page.goto('/');
  for (const path of [
    'vendored/pdf-lib/with_cropbox.pdf',
    'vendored/pypdf/habibi-rotated.pdf',
    'fetched/irs/fw9.pdf',
  ]) {
    await openFixture(page, path);
    await renderedPage(page, 1);
    expect(await inkCoverage(page, 1), path).toBeGreaterThan(0);
  }
});

interface ManifestEntry {
  path: string;
  password: string | null;
  pageCount: number;
  xfa: string;
}
const manifest = JSON.parse(
  readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8'),
) as ManifestEntry[];

// Sprint 1 exit criterion: every fixture class opens and renders its first page. Dynamic XFA
// renders the placeholder page that non-Adobe readers show. Fetched fixtures are skipped until
// `pnpm fixtures:fetch` has run.
test('every fixture in the manifest opens and renders', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  const opened: string[] = [];
  for (const entry of manifest) {
    const path = entry.path.replace(/^fixtures\//, '');
    if (!existsSync(new URL(`../${entry.path}`, import.meta.url))) continue;
    await openFixture(page, path, entry.password ? entry.password : undefined);
    await expect(page.getByText(`Page 1 of ${entry.pageCount}`), path).toBeVisible();
    await renderedPage(page, 1);
    await expect(page.getByRole('alert'), path).toHaveCount(0);
    opened.push(path);
  }
  expect(opened.length).toBeGreaterThanOrEqual(
    manifest.filter((entry) => entry.path.startsWith('fixtures/vendored/')).length,
  );
});

test('the 20-page, 10 MB fixture pages through without errors @all-engines', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await openFixture(page, 'vendored/generated/large-20p.pdf');
  await renderedPage(page, 1);
  for (let number = 2; number <= 20; number++) {
    await page.keyboard.press(']');
    await renderedPage(page, number);
    expect(await inkCoverage(page, number)).toBeGreaterThan(0);
  }
  await expect(page.getByText('Page 20 of 20')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Page 3', exact: true }).click();
  await expect(page.getByText('Page 3 of 20')).toBeVisible();
  await renderedPage(page, 3);
});

test('the password dialog retries and cancels (D3) @all-engines', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/acroform-all-aes256.pdf', 'wrong');
  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await expect(dialog.getByRole('alert')).toContainText('did not open');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();

  await openFixture(page, 'vendored/generated/acroform-all-aes256.pdf', 'bogey');
  await renderedPage(page, 1);
});

test('a file that is not a PDF is refused in plain language (D1, U6)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-input').setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('These are notes, not a PDF.'),
  });
  await expect(page.getByRole('alert')).toContainText('not a PDF');
});

test('every zoom preset renders the page at its size (V3) @all-engines', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/rotate-0.pdf');
  const first = await renderedPage(page, 1);
  for (const [label, zoom] of [
    ['50%', 0.5],
    ['100%', 1],
    ['300%', 3],
  ] as const) {
    await page.getByRole('button', { name: /Zoom level/ }).click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    await expect(page.getByRole('button', { name: `Zoom level: ${label}` })).toBeVisible();
    await expect
      .poll(async () => (await renderedPage(page, 1)).cssWidth)
      .toBeCloseTo((612 * 4 * zoom) / 3, 0);
  }
  await page.getByRole('button', { name: /Zoom level/ }).click();
  await page.getByRole('menuitemradio', { name: 'Fit width' }).click();
  await expect
    .poll(async () => (await renderedPage(page, 1)).cssWidth)
    .toBeCloseTo(first.cssWidth, 0);
});
