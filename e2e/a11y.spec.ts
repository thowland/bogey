// Accessibility (U4, spec §13, Sprint 10): axe with the WCAG 2.2 AA rule set on every screen and
// dialog, and a keyboard-only walkthrough from opening a document to downloading it. VoiceOver on
// macOS and iPadOS is manual (docs/manual-acceptance.md).
//
// axe is injected with Playwright's evaluate, which runs outside the page's CSP and Trusted Types,
// and it sets no inline styles, so these tests stay under the violation fixture: a scan that made
// the page break its own policy would fail here as it would anywhere else. axe's final step runs
// in a blank page of its own, which the fixture does not watch. No screenshots are taken.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  download,
  drawSignature,
  expect,
  fieldLayer,
  fillSnippets,
  fixture,
  openFixture,
  pageArea,
  readExport,
  renderedPage,
  snippetsPanel,
  test,
} from './helpers.ts';

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** axe's violations on the page as it stands, one line per failing node. */
async function violations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  return violations.flatMap((rule) =>
    rule.nodes.map((node) => `${rule.id}: ${node.target.join(' ')} — ${node.failureSummary}`),
  );
}

async function expectClean(page: Page, screen: string) {
  expect.soft(await violations(page), screen).toEqual([]);
}

const panel = (page: Page) =>
  page.getByRole('complementary', { name: /fields, snippets and signatures/i });

test('the empty state, the panel tabs and the information pages @all-engines', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
  await expectClean(page, 'empty state');

  for (const tab of ['Fields', 'Snippets', 'Signatures']) {
    await panel(page).getByRole('tab', { name: tab }).click();
    await expectClean(page, `${tab} tab, no document`);
  }
  await snippetsPanel(page);
  await panel(page).getByRole('button', { name: 'Edit snippets' }).click();
  await expectClean(page, 'Snippets tab, editing');
  await panel(page).getByRole('button', { name: 'Done' }).click();

  for (const [link, heading] of [
    ['Help', 'Help'],
    ['About', 'About Bogey'],
    ['Privacy', 'Privacy'],
  ] as const) {
    await page
      .getByRole('navigation', { name: 'Information' })
      .getByRole('button', { name: link })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectClean(page, `${link} page`);
  }
});

test('a document with fields and overlays, and every panel tab @all-engines', async ({ page }) => {
  await page.goto('/');
  await drawSignature(page, 'Mine');
  await openFixture(page, 'vendored/generated/acroform-all.pdf');
  await renderedPage(page, 1);
  await fieldLayer(page).getByRole('textbox', { name: 'text1' }).fill('Ada Lovelace');
  await fieldLayer(page).getByRole('checkbox', { name: 'check1' }).check();

  const { box } = await pageArea(page);
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: /^Text/ }).click();
  // In the left margin, clear of every field: a text overlay is as small as its text, and axe
  // passes a small target only with clear space around it (WCAG 2.5.8). Near a field, Linux font
  // metrics closed the gap.
  await page.mouse.click(box.x + 20, box.y + 60);
  await page.keyboard.type('Signed in Boston');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Place Mine' }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + 120);
  await expect(
    page.getByRole('button', { name: 'Signature overlay: Mine, page 1', exact: true }),
  ).toBeVisible();
  // The signature is selected, so its frame, handle and Delete button are on screen too.
  await expectClean(page, 'document with fields and a selected overlay');

  for (const tab of ['Fields', 'Snippets', 'Signatures']) {
    await panel(page).getByRole('tab', { name: tab }).click();
    await expectClean(page, `${tab} tab, with a document`);
  }
});

test('a flat page at 300%, scrolled, with nothing focusable on it @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/flat-single.pdf');
  await renderedPage(page, 1);
  await page.getByRole('button', { name: /Zoom level/ }).click();
  await page.getByRole('menuitemradio', { name: '300%', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zoom level: 300%' })).toBeVisible();
  await renderedPage(page, 1);
  await expectClean(page, 'flat page at 300%');
  await page.getByRole('button', { name: 'Zoom level: 300%' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expectClean(page, 'zoom menu');
  await page.keyboard.press('Escape');
});

test('every dialog @all-engines', async ({ page }) => {
  await page.goto('/');

  // Settings, the shortcuts list and the Clear everything confirmation.
  await page.locator('header').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expectClean(page, 'Settings dialog');
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Done' })
    .click();

  await page.getByRole('button', { name: 'Shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expectClean(page, 'Keyboard shortcuts dialog');
  await page.keyboard.press('Escape');

  await page.locator('header').getByRole('button', { name: 'Clear everything' }).click();
  const clear = page.getByRole('alertdialog', { name: 'Clear everything?' });
  await expect(clear).toBeVisible();
  await expectClean(page, 'Clear everything dialog');
  await clear.getByRole('button', { name: 'Cancel' }).click();

  // Draw and upload a signature.
  await panel(page).getByRole('tab', { name: 'Signatures' }).click();
  await panel(page).getByRole('button', { name: 'Draw' }).click();
  const draw = page.getByRole('dialog', { name: 'Draw a signature' });
  await expect(draw).toBeVisible();
  await expectClean(page, 'Draw dialog');
  await draw.getByRole('button', { name: 'Save' }).click();
  await expect(draw.getByRole('alert')).toBeVisible();
  await expectClean(page, 'Draw dialog with its error');
  await draw.getByRole('button', { name: 'Cancel' }).click();

  await panel(page).getByRole('button', { name: 'Upload' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload a signature' });
  await expect(upload).toBeVisible();
  await expectClean(page, 'Upload dialog');
  await upload.getByLabel('Image file').setInputFiles({
    name: 'scan.png',
    mimeType: 'image/png',
    buffer: await whitePng(page),
  });
  await expect(upload.getByRole('slider', { name: /Background cutoff/ })).toBeVisible();
  await expectClean(page, 'Upload dialog with an image');
  await upload.getByRole('button', { name: 'Cancel' }).click();

  // Snippets import, overwriting a changed value.
  const snippets = await fillSnippets(page, { 'Full name': 'Ada Lovelace' });
  const file = await download(page, () => snippets.getByRole('button', { name: 'Export' }).click());
  await fillSnippets(page, { 'Full name': 'Charles Babbage' });
  await snippets.getByTestId('snippets-import-input').setInputFiles({
    name: 'bogey-snippets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(file.bytes),
  });
  const overwrite = page.getByRole('dialog', { name: 'Overwrite snippets?' });
  await expect(overwrite).toBeVisible();
  await expectClean(page, 'Overwrite snippets dialog');
  await overwrite.getByRole('button', { name: 'Cancel' }).click();

  // The password dialog, with and without its error, then the export dialog's warning.
  await openFixture(page, 'vendored/generated/acroform-all-aes256.pdf', 'wrong');
  const password = page.getByRole('dialog', { name: 'Password required' });
  await expect(password.getByRole('alert')).toBeVisible();
  await expectClean(page, 'Password dialog with its error');
  await password.getByLabel('Password').fill('bogey');
  await password.getByRole('button', { name: 'Open' }).click();
  await renderedPage(page, 1);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const exporting = page.getByRole('dialog', { name: 'Download a signed copy' });
  await expect(exporting).toContainText('password-protected');
  await expectClean(page, 'Export dialog');
  await exporting.getByRole('button', { name: 'Cancel' }).click();
});

/** A small PNG of a dark stroke on white, made in the page. */
async function whitePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 300, 100);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(30, 70);
    ctx.lineTo(270, 30);
    ctx.stroke();
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return Buffer.from(base64, 'base64');
}

// The keyboard walkthrough (U2, U4): no mouse. Open through the Open PDF button, fill a field,
// place a text overlay at the keyboard marker, nudge it, place and delete a check, and download.
// Focus must never fall to <body> or get stuck.
test('a keyboard-only session: open, fill, place, nudge, delete and download @all-engines', async ({
  page,
  browserName,
}) => {
  // Safari moves Tab between text fields only, unless "Press Tab to highlight each item" is on;
  // Option+Tab reaches every control, as it does for Safari users.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.goto('/');
  // The system file picker is Playwright's to answer; the button that opens it is pressed with
  // the keyboard.
  await page.getByRole('button', { name: 'Open PDF' }).first().focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (
    await chooser
  ).setFiles({
    name: 'acroform-all.pdf',
    mimeType: 'application/pdf',
    buffer: fixture('vendored/generated/acroform-all.pdf'),
  });
  await renderedPage(page, 1);

  // Tab reaches the first field, and on to the checkbox.
  const fields = fieldLayer(page);
  const text1 = fields.getByRole('textbox', { name: 'text1' });
  for (let i = 0; i < 80 && !(await isFocused(text1)); i++) await page.keyboard.press(tab);
  await expect(text1).toBeFocused();
  await page.keyboard.type('Ada Lovelace');
  for (let i = 0; i < 3; i++) await page.keyboard.press(tab);
  const check1 = fields.getByRole('checkbox', { name: 'check1' });
  await expect(check1).toBeFocused();
  await page.keyboard.press('Space');
  await expect(check1).toBeChecked();

  // T arms the text tool and focuses its marker; Escape gives focus back to the checkbox.
  await page.keyboard.press('t');
  await expect(marker(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(marker(page)).toHaveCount(0);
  await expect(check1).toBeFocused();

  // Enter on the marker places the text and opens it for typing.
  await page.keyboard.press('t');
  await expect(marker(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Keyboard text');
  await page.keyboard.press('Enter');
  const text = page.getByRole('button', {
    name: 'Text overlay: Keyboard text, page 1',
    exact: true,
  });
  await expect(text).toBeFocused();

  // Nudge it 10 pt right and 1 pt down.
  const before = (await text.boundingBox())!;
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await text.boundingBox())!.x).toBeGreaterThan(before.x + 10);
  await expect(text).toBeFocused();

  // A check placed the same way takes focus; Delete removes it and focus goes to the Select tool.
  await page.keyboard.press('c');
  await expect(marker(page)).toBeFocused();
  await page.keyboard.press('Enter');
  const check = page.getByRole('button', { name: 'Check mark overlay, page 1', exact: true });
  await expect(check).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(check).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select' }),
  ).toBeFocused();

  // Download with the shortcut; the copy carries the value and the nudged text.
  const file = await download(page, () => page.keyboard.press('ControlOrMeta+s'));
  const out = await readExport(file.bytes);
  expect(out.fieldCount).toBe(0);
  const words = out.text[0]!.map((item) => item.str).join(' ');
  expect(words).toContain('Ada Lovelace');
  expect(words).toContain('Keyboard text');
});

/** The keyboard placement marker of the armed tool. */
const marker = (page: Page) => page.getByRole('button', { name: /^Place .+ here$/ });

const isFocused = (locator: ReturnType<Page['getByRole']>) =>
  locator.evaluate((element) => element === document.activeElement).catch(() => false);
