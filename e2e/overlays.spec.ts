// Overlays and export end to end (Sprint 4, spec §7.2, §9, §14.5) under the production headers:
// place text, a check, a date and a drawn signature on a flat PDF, move and resize them, undo and
// redo, download, and read the file back with pdf-lib and pdf.js. The placement check compares
// the baseline the browser drew with the exported text at 10 pt and 36 pt (acceptance 2).
import type { Page } from '@playwright/test';
import {
  download,
  drawSignature,
  expect,
  letterPoint,
  openFixture,
  pageArea,
  readExport,
  renderedPage,
  test,
} from './helpers.ts';

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
};

const near = (actual: number, expected: number, within: number, what: string) =>
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThan(within);

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

const centre = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

test('a flat PDF: place, move, resize, undo, redo and download @all-engines', async ({ page }) => {
  await page.goto('/');
  await drawSignature(page, 'Drawn');
  await openFixture(page, 'vendored/generated/flat-single.pdf');
  await renderedPage(page, 1);
  const { box } = await pageArea(page);
  const at = (x: number, y: number) => [box.x + x, box.y + y] as const;

  // Text: the T tool, a click, typing, Enter.
  await page.keyboard.press('t');
  await page.mouse.click(...at(100, 150));
  await page.keyboard.type('Jane Doe');
  await page.keyboard.press('Enter');
  const text = page.getByRole('button', { name: 'Text overlay: Jane Doe, page 1', exact: true });
  await expect(text).toBeFocused();

  // A check and today's date.
  await page.keyboard.press('c');
  await page.mouse.click(...at(100, 250));
  const check = page.getByRole('button', { name: 'Check mark overlay, page 1', exact: true });
  await expect(check).toBeVisible();
  await page.keyboard.press('d');
  await page.mouse.click(...at(100, 350));
  await expect(
    page.getByRole('button', { name: `Date overlay: ${today()}, page 1`, exact: true }),
  ).toBeVisible();

  // The drawn signature, chosen in the panel and placed with a click.
  await page.getByRole('button', { name: 'Place Drawn' }).click();
  await page.mouse.click(...at(300, 450));
  const signature = page.getByRole('button', {
    name: 'Signature overlay: Drawn, page 1',
    exact: true,
  });
  await expect(signature).toBeVisible();
  const placed = (await signature.boundingBox())!;

  // Move the check 60 px right, then make the signature larger.
  await dragBy(page, centre((await check.boundingBox())!), 60, 0);
  await expect.poll(async () => centre((await check.boundingBox())!).x).toBeCloseTo(box.x + 160, 0);
  await signature.click();
  const handle = page.getByTestId('resize-handle');
  await dragBy(page, centre((await handle.boundingBox())!), 80, 30);
  await expect
    .poll(async () => (await signature.boundingBox())!.width)
    .toBeGreaterThan(placed.width + 40);

  // Undo the resize and the move, then redo the move.
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await signature.boundingBox())!.width)
    .toBeCloseTo(placed.width, 0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => centre((await check.boundingBox())!).x).toBeCloseTo(box.x + 100, 0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => centre((await check.boundingBox())!).x).toBeCloseTo(box.x + 160, 0);

  const file = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  expect(file.name).toBe('flat-single-signed.pdf');
  await expect(page.getByText('Downloaded flat-single-signed.pdf.')).toBeVisible();

  const out = await readExport(file.bytes);
  expect(out).toMatchObject({ pageCount: 1, fieldCount: 0, encrypted: false, producer: 'Bogey' });
  const items = out.text[0]!;
  const find = (s: string) => items.find((item) => item.str.includes(s));

  const textAt = letterPoint(box, 0, { x: 100, y: 150 });
  const jane = find('Jane Doe')!;
  near(jane.transform[4]!, textAt.x, 1, 'text x');
  near(jane.transform[5]!, textAt.y, 1, 'text y');
  expect(find(today())).toBeDefined();

  // The check is centred where it was moved to; its glyph starts 0.077 of its size in.
  const checkCentre = letterPoint(box, 0, { x: 160, y: 250 });
  const glyph = items.find((item) => item.transform[0] === 12 && item !== jane)!;
  expect(glyph, 'check glyph').toBeDefined();
  near(glyph.transform[4]!, checkCentre.x - 6 + 0.077 * 12, 1.5, 'check x');

  // One signature image, 150 pt wide (the resize was undone), centred on the click.
  expect(out.images[0]).toHaveLength(1);
  const [a, , , d, e, f] = out.images[0]![0]!;
  near(a!, 150, 0.01, 'signature width');
  const sigCentre = letterPoint(box, 0, { x: 300, y: 450 });
  near(e! + a! / 2, sigCentre.x, 1, 'signature centre x');
  near(f! + d! / 2, sigCentre.y, 1, 'signature centre y');
});

/** The first baseline's left end of a text overlay as the browser laid it out, in page px. */
async function baseline(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).evaluate((button) => {
    const text = button.querySelector('span')!;
    const marker = document.createElement('span');
    marker.style.display = 'inline-block';
    text.prepend(marker);
    const sheet = button.closest('[data-testid="overlay-layer"]')!.getBoundingClientRect();
    const m = marker.getBoundingClientRect();
    marker.remove();
    return { x: m.left - sheet.left, y: m.bottom - sheet.top };
  });
}

for (const [fixture, rotate] of [
  ['flat-single.pdf', 0],
  ['rotate-90.pdf', 90],
] as const) {
  test(`text on screen and in the export agree within 1 pt at 10 and 36 pt on ${fixture} @all-engines`, async ({
    page,
  }) => {
    await page.goto('/');
    await openFixture(page, `vendored/generated/${fixture}`);
    await renderedPage(page, 1);
    await page.evaluate(() => document.fonts.ready);
    const { box } = await pageArea(page);

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 120, box.y + 140);
    await page.keyboard.type('Small text');
    await page.keyboard.press('Enter');
    await page.keyboard.press('t');
    await page.mouse.click(box.x + 150, box.y + 320);
    await page.keyboard.type('Large text');
    await page.keyboard.press('Enter');
    await page
      .getByRole('group', { name: 'Selected overlay' })
      .getByRole('combobox', { name: 'Size' })
      .selectOption('36');

    const screen = {
      Small: letterPoint(box, rotate, await baseline(page, 'Text overlay: Small text, page 1')),
      Large: letterPoint(box, rotate, await baseline(page, 'Text overlay: Large text, page 1')),
    };
    const file = await download(page, () => page.keyboard.press('ControlOrMeta+s'));
    const items = (await readExport(file.bytes)).text[0]!;
    for (const [word, size] of [
      ['Small', 10],
      ['Large', 36],
    ] as const) {
      const item = items.find((i) => i.str.startsWith(word))!;
      expect(Math.hypot(item.transform[0]!, item.transform[1]!)).toBeCloseTo(size, 3);
      near(item.transform[4]!, screen[word].x, 1, `${word} x`);
      near(item.transform[5]!, screen[word].y, 1, `${word} y`);
    }
  });
}

test('characters Helvetica cannot write are listed and replaced on request (E4)', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/flat-single.pdf');
  await renderedPage(page, 1);
  const { box } = await pageArea(page);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.keyboard.type('Price → 5 €');
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Download a signed copy' });
  await expect(dialog).toContainText('Text on page 1, “Price → 5 €”: “→”');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const file = await download(page, () =>
    dialog.getByRole('button', { name: 'Replace with ? and download' }).click(),
  );
  const items = (await readExport(file.bytes)).text[0]!;
  expect(items.map((i) => i.str).join(' ')).toContain('Price ? 5 €');
});
