// Signature capture end to end (spec §8, §14.5) under the production headers: draw with
// synthetic pen events of varying pressure, upload an image on white, and find both in the
// library after a reload. Runs in every engine, since WebKit's IndexedDB is the one that has
// failed before (spec §10.5).
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './helpers.ts';

async function openSignatures(page: Page): Promise<Locator> {
  const panel = page.getByRole('complementary', { name: /fields, snippets and signatures/i });
  await panel.getByRole('tab', { name: 'Signatures' }).click();
  return panel;
}

/** Dispatches a pen stroke in the page, with pressure rising along it. */
async function drawPenStroke(canvas: Locator, points: [number, number][]) {
  await canvas.evaluate((element, pts) => {
    const rect = element.getBoundingClientRect();
    const fire = (type: string, [x, y]: [number, number], pressure: number, buttons: number) =>
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: 'pen',
          isPrimary: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
          pressure,
          buttons,
          button: type === 'pointermove' ? -1 : 0,
        }),
      );
    pts.forEach((pt, i) =>
      fire(i === 0 ? 'pointerdown' : 'pointermove', pt, 0.2 + (0.8 * i) / pts.length, 1),
    );
    fire('pointerup', pts.at(-1)!, 0, 0);
  }, points);
}

/** A PNG of a dark scribble on white paper, made in the page. */
async function scribblePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, 900, 300);
    ctx.strokeStyle = '#102030';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(150, 200);
    ctx.bezierCurveTo(300, 40, 500, 280, 750, 100);
    ctx.stroke();
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return Buffer.from(base64, 'base64');
}

test('draw and upload signatures, and keep them across a reload @all-engines', async ({ page }) => {
  await page.goto('/');
  let panel = await openSignatures(page);
  await expect(panel.getByText('Signatures you draw or upload are kept here.')).toBeVisible();

  // Draw: an empty canvas cannot be saved; a pen stroke can.
  await panel.getByRole('button', { name: 'Draw' }).click();
  const draw = page.getByRole('dialog', { name: 'Draw a signature' });
  await draw.getByRole('button', { name: 'Save' }).click();
  await expect(draw.getByRole('alert')).toContainText('nothing to save');
  const canvas = draw.getByRole('img', { name: 'Signature drawing area' });
  await expect(canvas).toHaveCSS('touch-action', 'none');
  await drawPenStroke(canvas, [
    [80, 140],
    [140, 70],
    [210, 150],
    [280, 80],
    [360, 130],
  ]);
  await draw.getByRole('textbox', { name: 'Name' }).fill('Drawn');
  await draw.getByRole('button', { name: 'Save' }).click();
  await expect(draw).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Place Drawn' })).toBeVisible();

  // Upload: a PNG on white, saved as initials after moving the threshold.
  await panel.getByRole('button', { name: 'Upload' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload a signature' });
  await upload.getByLabel('Image file').setInputFiles({
    name: 'scan.png',
    mimeType: 'image/png',
    buffer: await scribblePng(page),
  });
  const slider = upload.getByRole('slider', { name: /Background cutoff/ });
  await slider.fill('220');
  await expect(slider).toHaveValue('220');
  await upload.getByRole('radio', { name: 'Initials' }).check();
  await upload.getByRole('button', { name: 'Save' }).click();
  await expect(upload).toBeHidden();

  // Both survive a reload, grouped by kind, with thumbnails that loaded.
  await page.reload();
  panel = await openSignatures(page);
  const drawn = panel.getByRole('region', { name: 'Signatures' }).getByRole('button', {
    name: 'Place Drawn',
  });
  const initials = panel.getByRole('region', { name: 'Initials' }).getByRole('button', {
    name: 'Place Initials',
  });
  await expect(drawn).toBeVisible();
  await expect(initials).toBeVisible();
  for (const thumb of [drawn.locator('img'), initials.locator('img')]) {
    await expect
      .poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
  }

  // Choosing one enters place-signature mode (Sprint 4 places it).
  await drawn.click();
  await expect(drawn).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByText('Click the page where the signature should go.')).toBeVisible();
});
