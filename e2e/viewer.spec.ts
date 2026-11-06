// The viewer under the production headers (Sprint 1): opening, rendering, paging, zoom and the
// password flow. The violation fixture fails any test that raises a CSP or Trusted Types report.
import { expect, inkCoverage, openFixture, renderedPage, test } from './helpers.ts';

test('a flat PDF opens and renders @all-engines', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto('/');
  await openFixture(page, 'vendored/generated/flat-single.pdf');
  await renderedPage(page, 1);
  expect(await inkCoverage(page, 1)).toBeGreaterThan(0);
  console.log(requests.filter((path) => path.includes('pdf')).join('\n'));
});

test('JBIG2 and JPEG 2000 images decode with the WASM decoders @all-engines', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto('/');
  await openFixture(page, 'fetched/pdfjs/issue3371.pdf', 'ELXRTQWS');
  await renderedPage(page, 1);
  expect(await inkCoverage(page, 1)).toBeGreaterThan(0);
  console.log(requests.filter((path) => path.includes('pdfjs')).join('\n'));
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
