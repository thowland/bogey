// Snippets, settings and Close PDF end to end (Sprint 7: N1–N4, M2, O5, acceptance 5) under the
// production headers. Tests under the violation fixture take no screenshots.
import {
  download,
  drawSignature,
  expect,
  fieldLayer,
  fillSnippets,
  openFixture,
  pageArea,
  readExport,
  renderedPage,
  snippetButton,
  snippetsPanel,
  test,
  todayIn,
  waitForSaved,
} from './helpers.ts';

const FORM = 'vendored/generated/acroform-all.pdf';
const FLAT = 'vendored/generated/flat-single.pdf';

test('a snippet fills the focused field, which keeps focus', async ({ page }) => {
  await page.goto('/');
  const panel = await fillSnippets(page, { 'Full name': 'Ada Lovelace' });
  await openFixture(page, FORM);
  await renderedPage(page, 1);

  const field = fieldLayer(page).getByRole('textbox', { name: 'text1' });
  await field.click();
  await expect(panel.getByTestId('snippet-target')).toHaveText('Fills: text1');
  await snippetButton(panel, 'Full name').click();
  await expect(field).toHaveValue('Ada Lovelace');
  await expect(field).toBeFocused();
  // An empty snippet is shown but cannot be used.
  await expect(snippetButton(panel, 'Phone')).toBeDisabled();
});

test('a snippet becomes a text overlay where the page was last clicked', async ({ page }) => {
  await page.goto('/');
  const panel = await fillSnippets(page, {
    'Full name': 'Ada Lovelace',
    'Address line 1': '12 St James Square',
  });
  await openFixture(page, FLAT);
  await renderedPage(page, 1);
  const { box } = await pageArea(page);

  // With no click yet, the snippet goes near the top-left corner.
  await expect(panel.getByTestId('snippet-target')).toContainText('top-left corner');
  await page.mouse.click(box.x + 150, box.y + 200);
  await expect(panel.getByTestId('snippet-target')).toHaveText(
    'Places text where you last clicked on the page.',
  );
  await snippetButton(panel, 'Full name').click();
  await snippetButton(panel, 'Address line 1').click();

  const name = page.getByRole('button', {
    name: 'Text overlay: Ada Lovelace, page 1',
    exact: true,
  });
  const street = page.getByRole('button', {
    name: 'Text overlay: 12 St James Square, page 1',
    exact: true,
  });
  await expect(name).toBeVisible();
  await expect(street).toBeVisible();
  const first = (await name.boundingBox())!;
  const second = (await street.boundingBox())!;
  // The first starts at the click; the second sits one line underneath it.
  expect(Math.abs(first.x - (box.x + 150))).toBeLessThan(3);
  expect(Math.abs(second.x - first.x)).toBeLessThan(1);
  expect(second.y - first.y).toBeGreaterThan(first.height * 0.8);
  expect(second.y - first.y).toBeLessThan(first.height * 1.5);
});

test('snippets export to JSON and import back, confirming overwrites', async ({ page }) => {
  await page.goto('/');
  let panel = await fillSnippets(page, { 'Full name': 'Ada Lovelace', Email: 'ada@example.com' });

  const file = await download(page, () => panel.getByRole('button', { name: 'Export' }).click());
  expect(file.name).toBe('bogey-snippets.json');
  const json = JSON.parse(Buffer.from(file.bytes).toString('utf8')) as {
    bogeySnippets: number;
    snippets: { label: string; value: string }[];
  };
  expect(json.bogeySnippets).toBe(1);
  expect(json.snippets.map((s) => s.label)).toEqual([
    'Full name',
    'Address line 1',
    'Address line 2',
    'City/State/ZIP',
    'Phone',
    'Email',
  ]);
  expect(json.snippets[0]!.value).toBe('Ada Lovelace');

  // Change a value; the change survives a reload, and the import puts the old value back.
  await fillSnippets(page, { 'Full name': 'Charles Babbage' });
  await page.reload();
  panel = await snippetsPanel(page);
  await expect(snippetButton(panel, 'Full name')).toHaveAccessibleDescription('Charles Babbage');

  await panel.getByTestId('snippets-import-input').setInputFiles({
    name: 'bogey-snippets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(file.bytes),
  });
  const confirm = page.getByRole('dialog', { name: 'Overwrite snippets?' });
  await expect(confirm.getByRole('listitem')).toHaveText(['Full name']);
  await confirm.getByRole('button', { name: 'Import' }).click();
  await expect(snippetButton(panel, 'Full name')).toHaveAccessibleDescription('Ada Lovelace');
  await expect(page.getByText('Updated 1 snippet.')).toBeVisible();

  // A file that is not a snippets file is refused with a reason.
  await panel.getByTestId('snippets-import-input').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"__proto__": {"polluted": true}}'),
  });
  await expect(panel.getByRole('alert')).toHaveText(
    'That file is not a Bogey snippets file, so nothing was imported.',
  );
});

test('the date format setting changes the date Today places', async ({ page }) => {
  await page.goto('/');
  await page.locator('header').getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('combobox', { name: 'Date format' }).selectOption('YYYY-MM-DD');
  await settings.getByRole('combobox', { name: 'Default text size' }).selectOption('14');
  await settings.getByRole('button', { name: 'Done' }).click();

  await openFixture(page, FLAT);
  await renderedPage(page, 1);
  const panel = await snippetsPanel(page);
  await snippetButton(panel, 'Today').click();
  const date = page.getByRole('button', {
    name: `Date overlay: ${todayIn('YYYY-MM-DD')}, page 1`,
    exact: true,
  });
  await expect(date).toBeVisible();
  // The new overlay uses the default size: selecting it shows 14 pt.
  await date.click();
  await expect(
    page.getByRole('group', { name: 'Selected overlay' }).getByRole('combobox', { name: 'Size' }),
  ).toHaveValue('14');

  // The setting is kept after a reload.
  await page.reload();
  await page.locator('header').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('combobox', { name: 'Date format' })).toHaveValue('YYYY-MM-DD');
});

test('Close PDF returns to the recent list', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, FLAT);
  await renderedPage(page, 1);
  await waitForSaved(page, 'flat-single.pdf');
  await page.getByRole('button', { name: 'Close PDF' }).click();
  const recent = page.getByRole('region', { name: 'Recent documents' });
  await expect(recent).toBeVisible();
  await expect(recent.getByText('flat-single.pdf')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close PDF' })).toBeHidden();
});

test('the ? key lists the keyboard shortcuts', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Shift+Slash');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Download the signed copy.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

// Acceptance 5: the second form, filled from snippets, signed from the library and downloaded,
// in under a minute.
test('open, fill from snippets, sign from the library and export @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  await drawSignature(page, 'Mine');
  const panel = await fillSnippets(page, {
    'Full name': 'Ada Lovelace',
    'Address line 1': '12 St James Square',
    Phone: '555123456',
  });

  const started = Date.now();
  await openFixture(page, FORM);
  await renderedPage(page, 1);
  const fields = fieldLayer(page);
  await snippetsPanel(page);
  for (const [field, label] of [
    ['text1', 'Full name'],
    ['multiline1', 'Address line 1'],
    ['comb1', 'Phone'],
  ] as const) {
    await fields.getByRole('textbox', { name: field }).click();
    await expect(panel.getByTestId('snippet-target')).toHaveText(`Fills: ${field}`);
    await snippetButton(panel, label).click();
  }
  await expect(fields.getByRole('textbox', { name: 'comb1' })).toHaveValue('555123456');

  const { box } = await pageArea(page);
  await page.mouse.click(box.x + 60, box.y + 60);
  await snippetButton(panel, 'Today').click();
  await expect(
    page.getByRole('button', { name: `Date overlay: ${todayIn('MM/DD/YYYY')}, page 1` }),
  ).toBeVisible();

  await panel.getByRole('tab', { name: 'Signatures' }).click();
  await page.getByRole('button', { name: 'Place Mine' }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + 120);
  await expect(
    page.getByRole('button', { name: 'Signature overlay: Mine, page 1', exact: true }),
  ).toBeVisible();

  const file = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  expect(Date.now() - started).toBeLessThan(60_000);
  const out = await readExport(file.bytes);
  expect(out).toMatchObject({ pageCount: 1, fieldCount: 0, encrypted: false });
  const text = out.text[0]!.map((item) => item.str).join(' ');
  for (const value of ['Ada Lovelace', '12 St James Square', todayIn('MM/DD/YYYY')]) {
    expect(text).toContain(value);
  }
  expect(out.images[0]).toHaveLength(1);
});
