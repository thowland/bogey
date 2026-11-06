// Touch and iPad (Sprint 8, V4, V6, O7, P3, spec §7.2, §10.3, §10.4, §14.5) under the production
// headers. The iPad Pro 11 descriptor runs in WebKit with touch on. Playwright has no pinch or
// touch-drag API, so gestures are synthesized: WebKit gesture events and touch pointer events are
// dispatched in the page (a pinch on a real iPad is in docs/ipad-checklist.md), taps use the real
// touchscreen, and Chromium gets a real two-finger pinch through the DevTools protocol.
// Tests under the violation fixture take no screenshots.
import { devices, type Page } from '@playwright/test';
import {
  expect,
  openFixture,
  renderedPage,
  pageSheet,
  pinchInPage,
  test,
  touchDragInPage,
  watchViolations,
  zoomLabel,
} from './helpers.ts';

// Everything but the browser type, which a describe block cannot set.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPad Pro 11'];
const iPad = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };

/** The zoom the app shows, from the zoom menu button (for example 150). */
async function zoomPercent(page: Page): Promise<number> {
  return Number((await zoomLabel(page)).replace('%', ''));
}

test.describe('iPad Pro 11 (WebKit, touch) @all-engines', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad descriptor runs in WebKit');
  test.use(iPad);

  test('a pinch changes the app zoom, not the page scale', async ({ page }) => {
    await page.goto('/');
    await openFixture(page, 'vendored/generated/flat-single.pdf');
    await renderedPage(page, 1);
    const toolbar = await page.getByRole('banner').boundingBox();
    const before = (await pageSheet(page).boundingBox())!;
    await page.getByRole('button', { name: /Zoom level/ }).click();
    await page.getByRole('menuitemradio', { name: '100%', exact: true }).click();
    await expect.poll(() => zoomPercent(page)).toBe(100);

    // A pinch over the toolbar is cancelled too, so Safari never zooms the app itself.
    const outside = await pinchInPage(page, 'header', [1, 1.5, 2]);
    expect(outside.prevented).toBe(true);
    expect(await zoomPercent(page)).toBe(100);

    const pinch = await pinchInPage(page, '[data-page]:not([hidden])', [1, 1.3, 1.6, 2]);
    expect(pinch.prevented).toBe(true);
    // While the fingers move, the page is scaled with a transform.
    expect(pinch.during).toMatch(/scale\(1\.6\)/);
    await expect.poll(() => zoomPercent(page)).toBe(200);
    await expect
      .poll(async () => (await renderedPage(page, 1)).cssWidth)
      .toBeCloseTo((612 * 4 * 2) / 3, 0);
    expect(await pageSheet(page).evaluate((sheet) => sheet.style.transform)).toBe('');
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    expect(await page.getByRole('banner').boundingBox()).toEqual(toolbar);
    expect(before.width).toBeGreaterThan(0);

    // Pinching in commits no lower than 50%.
    await pinchInPage(page, '[data-page]:not([hidden])', [1, 0.5, 0.1]);
    await expect.poll(() => zoomPercent(page)).toBe(50);
  });

  test('a tap places an overlay, a pan places nothing, and handles are 44 px', async ({ page }) => {
    await page.goto('/');
    await openFixture(page, 'vendored/generated/flat-single.pdf');
    await renderedPage(page, 1);
    const layer = page.getByTestId('overlay-layer');
    await page.getByRole('button', { name: 'Check', exact: true }).tap();
    await expect(layer).toHaveCSS('touch-action', 'pan-x pan-y');

    // A one-finger drag of 40 px is a pan.
    await touchDragInPage(page, '[data-testid="overlay-layer"]', { x: 120, y: 200 }, 0, 40);
    await touchDragInPage(page, '[data-testid="overlay-layer"]', { x: 120, y: 200 }, 30, 0);
    const checks = page.getByRole('button', { name: /^Check mark overlay/ });
    await expect(checks).toHaveCount(0);

    // A tap with the real touchscreen places one and returns to the select tool.
    const box = (await layer.boundingBox())!;
    await page.touchscreen.tap(box.x + 150, box.y + 220);
    await expect(checks).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Selected on placement: the resize handle and delete button have finger-sized hit areas.
    for (const target of [
      page.getByTestId('resize-handle'),
      page.getByRole('button', { name: /^Delete/ }),
    ]) {
      const hit = (await target.boundingBox())!;
      expect(hit.width).toBeGreaterThanOrEqual(44);
      expect(hit.height).toBeGreaterThanOrEqual(44);
    }

    // Text by tap, typed with the keyboard.
    await page.getByRole('button', { name: 'Text', exact: true }).tap();
    await page.touchscreen.tap(box.x + 150, box.y + 400);
    await page.keyboard.type('Tapped');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Text overlay: Tapped, page 1', exact: true }),
    ).toBeVisible();
  });

  test('the 20-page fixture keeps three canvases within the caps (V6)', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await openFixture(page, 'vendored/generated/large-20p.pdf');
    await renderedPage(page, 1);
    await page.getByRole('button', { name: /Zoom level/ }).click();
    await page.getByRole('menuitemradio', { name: '300%', exact: true }).click();
    for (let number = 1; number <= 20; number++) {
      if (number > 1) await page.getByRole('button', { name: 'Next page' }).tap();
      await renderedPage(page, number);
      const canvases = await page
        .getByRole('region', { name: /^Page \d+ of 20$/ })
        .evaluate((area) =>
          [...area.querySelectorAll('canvas')]
            .filter((canvas) => canvas.width > 0)
            .map((canvas) => ({
              page: Number(canvas.closest<HTMLElement>('[data-page]')!.dataset.page),
              pixels: canvas.width * canvas.height,
            })),
        );
      expect(canvases.length, `page ${number}`).toBeLessThanOrEqual(3);
      for (const canvas of canvases) {
        expect(Math.abs(canvas.page - number)).toBeLessThanOrEqual(1);
        // Current page: iOS Safari's per-canvas limit; neighbors: 2048 × 2048.
        expect(canvas.pixels).toBeLessThanOrEqual(canvas.page === number ? 16_777_216 : 4_194_304);
      }
    }
    await expect(page.getByText('Page 20 of 20')).toBeVisible();
  });
});

test.describe('the narrow layout at 800 px (P3) @all-engines', () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test('renders without errors, with a Pages toggle and an overlaid panel', async ({ page }) => {
    await page.goto('/');
    await openFixture(page, 'vendored/generated/multipage-rotations.pdf');
    await renderedPage(page, 1);
    const strip = page.getByRole('complementary', { name: 'Pages' });
    const panel = page.getByRole('complementary', { name: /fields, snippets and signatures/i });
    await expect(strip).toBeHidden();
    await expect(panel).toBeHidden();

    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await expect(strip).toBeVisible();
    await strip.getByRole('button', { name: 'Page 2', exact: true }).click();
    await expect(strip).toBeHidden();
    await renderedPage(page, 2);

    await page.getByRole('button', { name: 'Show panel' }).click();
    await expect(panel).toBeVisible();
    const area = (await page.getByRole('region', { name: /^Page 2 of/ }).boundingBox())!;
    const over = (await panel.boundingBox())!;
    // The panel sits over the page rather than beside it.
    expect(over.x).toBeLessThan(area.x + area.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      800,
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test('Ctrl+wheel zooms the page, not the browser (V4)', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/flat-single.pdf');
  await renderedPage(page, 1);
  await page.getByRole('button', { name: /Zoom level/ }).click();
  await page.getByRole('menuitemradio', { name: '100%', exact: true }).click();
  const box = (await pageSheet(page).boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.keyboard.down('Control');
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -20);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomPercent(page)).toBe(272);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  // Without Ctrl the wheel scrolls.
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => page.getByRole('region', { name: /^Page 1 of/ }).evaluate((area) => area.scrollTop))
    .toBeGreaterThan(0);
  expect(await zoomPercent(page)).toBe(272);
});

test('a real two-finger pinch in Chromium zooms the app, not the page', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'the DevTools protocol is Chromium only');
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const violations = watchViolations(page, browserName);
  try {
    await page.goto('/');
    await openFixture(page, 'vendored/generated/flat-single.pdf');
    await renderedPage(page, 1);
    await page.getByRole('button', { name: /Zoom level/ }).click();
    await page.getByRole('menuitemradio', { name: '100%', exact: true }).click();
    const box = (await pageSheet(page).boundingBox())!;
    const cx = box.x + 300;
    const cy = box.y + 300;
    const cdp = await context.newCDPSession(page);
    const fingers = (spread: number) => [
      { x: cx - spread, y: cy, id: 0 },
      { x: cx + spread, y: cy, id: 1 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(50) });
    for (let spread = 55; spread <= 75; spread += 5) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: fingers(spread),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => zoomPercent(page)).toBe(150);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    expect(violations).toEqual([]);
  } finally {
    await context.close();
  }
});
