import { readFileSync } from 'node:fs';
import { expect, test } from './helpers.ts';

const expected = JSON.parse(
  readFileSync(new URL('../apps/web/security/headers.json', import.meta.url), 'utf8'),
) as Record<string, string>;

// Runs in Chromium, Firefox and WebKit: the shell loads under the production headers with no
// violations. WebKit once rendered Mulligan blank here, which a Chromium-only suite could not see.
test('the shell loads under the production headers @all-engines', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response!.headers();
  for (const name of Object.keys(expected)) {
    if (name === 'Strict-Transport-Security') continue; // HTTPS only (spec §11.3)
    expect(headers[name.toLowerCase()], name).toBeTruthy();
  }
  expect(headers['content-security-policy']).toContain("connect-src 'self'");
  expect(headers['content-security-policy']).toContain("require-trusted-types-for 'script'");
  await expect(page.getByText('Bogey', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
  await expect(page.getByText(/works entirely inside this browser/)).toBeVisible();
});

test('the overlay font loads from the same origin @all-engines', async ({ page }) => {
  await page.goto('/');
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('16px "Bogey Overlay"');
    await document.fonts.load('bold 16px "Bogey Overlay"');
    return [...document.fonts].filter(
      (f) => f.family.includes('Bogey Overlay') && f.status === 'loaded',
    ).length;
  });
  expect(loaded).toBe(2);
});

test('Help, About and Privacy open in place and return', async ({ page }) => {
  await page.goto('/');
  for (const [link, heading] of [
    ['Help', 'Help'],
    ['About', 'About Bogey'],
    ['Privacy', 'Privacy'],
  ] as const) {
    await page.getByRole('button', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeFocused();
    await page.getByRole('button', { name: /back to your document/i }).click();
  }
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
});

test('storage opens in persistent mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
