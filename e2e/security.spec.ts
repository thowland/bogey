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
