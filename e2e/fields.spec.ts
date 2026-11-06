// Form fields end to end (Sprint 5, spec §7.1, §14.5) under the production headers: fill every
// field type, tab in document order and across pages, use the Fields panel, and see the XFA
// notices. The violation fixture is active, so these tests take no screenshots.
import { existsSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import {
  expect,
  download,
  fieldLayer,
  fieldsPanel,
  inkInBox,
  openFixture,
  readFlattened,
  renderedPage,
  test,
} from './helpers.ts';

const fetched = (path: string) => existsSync(new URL(`../fixtures/${path}`, import.meta.url));

const selected = (list: Locator) =>
  list.evaluate((el: HTMLSelectElement) => [...el.selectedOptions].map((o) => o.value));

/** Opens exported bytes in the app, as a user would open the downloaded copy. */
async function openExport(page: Page, bytes: Uint8Array) {
  await page.getByTestId('open-input').setInputFiles({
    name: 'export.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByRole('region', { name: /^Page 1 of / })).toBeVisible();
  await renderedPage(page, 1);
}

// The center of a checkbox: the box's own border is page content, the check is not.
const inner = ([x0, y0, x1, y1]: number[]): [number, number, number, number] => {
  const dx = (x1! - x0!) / 4;
  const dy = (y1! - y0!) / 4;
  return [x0! + dx, y0! + dy, x1! - dx, y1! - dy];
};

test('every field type fills, and the Fields panel shows the values @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/acroform-all.pdf');
  await renderedPage(page, 1);
  const layer = fieldLayer(page);
  await layer.getByRole('textbox', { name: 'text1' }).fill('Ada Lovelace');
  await layer.getByRole('textbox', { name: 'multiline1' }).fill('First line\nSecond line');
  const comb = layer.getByRole('textbox', { name: 'comb1' });
  await comb.fill('1234567890');
  await expect(comb).toHaveValue('123456789');
  await layer.getByRole('checkbox', { name: 'check1' }).check();
  await layer.getByRole('radio', { name: 'radio1: b' }).check();
  await layer.getByRole('combobox', { name: 'dropdown1' }).selectOption('Gamma');
  await layer.getByRole('listbox', { name: 'list1' }).selectOption(['Two', 'Four']);
  const readOnly = layer.getByRole('textbox', { name: 'readonly1' });
  await expect(readOnly).toHaveValue('Fixed value');
  await expect(readOnly).not.toBeEditable();
  await expect(layer.getByRole('img', { name: /^Button: button1\./ })).toBeVisible();

  const panel = await fieldsPanel(page);
  for (const [name, value] of [
    ['text1, Text', 'Ada Lovelace'],
    ['comb1, Text', '123456789'],
    ['check1, Checkbox', 'Checked'],
    ['radio1, Radio buttons', 'b'],
    ['dropdown1, Dropdown', 'Gamma'],
    ['list1, List', 'Two, Four'],
    ['readonly1, Text', 'Fixed value'],
  ] as const) {
    await expect(panel.getByRole('button', { name: `${name}, page 1: ${value}` })).toBeVisible();
  }
  await panel.getByRole('searchbox', { name: 'Filter fields by name' }).fill('drop');
  await expect(panel.getByText('1 of 9 fields')).toBeVisible();
  await panel.getByRole('button', { name: /^dropdown1,/ }).click();
  await expect(layer.getByRole('combobox', { name: 'dropdown1' })).toBeFocused();
});

test('Tab walks the fields in document order', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/acroform-all.pdf');
  await renderedPage(page, 1);
  await fieldLayer(page).getByRole('textbox', { name: 'text1' }).focus();
  const order: string[] = [];
  for (let i = 0; i < 7; i++) {
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(order).toEqual([
    'text1',
    'multiline1',
    'comb1',
    'check1',
    'radio1: a',
    'dropdown1',
    'list1',
  ]);
  await expect(fieldLayer(page).getByRole('textbox', { name: 'readonly1' })).toBeFocused();
});

test('Tab past the last field turns the page, and the Fields panel reaches other pages', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page, 'vendored/pdf-lib/with_combed_fields.pdf');
  await renderedPage(page, 1);
  const to = fieldLayer(page).getByRole('textbox', { name: /Reporting period.*\. To\./ });
  await to.fill('20261231');
  await to.press('Tab');
  await expect(page.getByText('Page 2 of 13')).toBeVisible();
  await expect(
    fieldLayer(page).getByRole('textbox', {
      name: /Line A\. Opening inventory\. Dried\/Fresh cannabis\. Flowering/,
    }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByText('Page 1 of 13')).toBeVisible();
  await expect(to).toBeFocused();
  await expect(to).toHaveValue('20261231');

  const panel = await fieldsPanel(page);
  await panel.getByRole('searchbox').fill('Packaged. Line E. Opening');
  await panel
    .getByRole('button', { name: /Line E\. Opening inventory\. Dried and fresh/ })
    .first()
    .click();
  await expect(page.getByText('Page 4 of 13')).toBeVisible();
  const target = fieldLayer(page).getByRole('textbox', {
    name: /Packaged\. Line E\. Opening inventory\. Dried and fresh/,
  });
  await expect(target.first()).toBeFocused();
  await expect(target.first()).toBeInViewport();
});

test('the W-9 fills its comb fields and boxes @all-engines', async ({ page }) => {
  test.skip(!fetched('fetched/irs/fw9.pdf'), 'run pnpm fixtures:fetch');
  await page.goto('/');
  await openFixture(page, 'fetched/irs/fw9.pdf');
  await renderedPage(page, 1);
  await expect(page.getByText(/This form also carries an Adobe XFA layer/)).toBeVisible();
  const layer = fieldLayer(page);
  await layer.getByRole('textbox', { name: 'f1_01[0]' }).fill('Tim Howland');
  for (const [name, digits] of [
    ['f1_11[0]', '123'],
    ['f1_12[0]', '45'],
    ['f1_13[0]', '6789'],
  ] as const) {
    const box = layer.getByRole('textbox', { name });
    await box.fill(`${digits}0`);
    await expect(box).toHaveValue(digits);
  }
  // "Other" (c1_1[6]) and line 3b (c1_2[0]).
  await layer.getByRole('checkbox', { name: 'c1_1[6]' }).check();
  await layer.getByRole('checkbox', { name: 'c1_2[0]' }).check();
  const panel = await fieldsPanel(page);
  await expect(panel.getByRole('button', { name: 'f1_13[0], Text, page 1: 6789' })).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'c1_1[6], Checkbox, page 1: Checked' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'c1_2[0], Checkbox, page 1: Checked' }),
  ).toBeVisible();
});

test('a dynamic XFA form explains its placeholder page @all-engines', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/xfa-dynamic.pdf');
  await renderedPage(page, 1);
  const notice = page.getByRole('status').filter({ hasText: 'This is an Adobe XFA form' });
  await expect(notice).toContainText('probably the placeholder page');
  await expect(fieldLayer(page)).toHaveCount(0);
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
});

test('a hybrid XFA form fills its AcroForm fields @all-engines', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/xfa-hybrid.pdf');
  await renderedPage(page, 1);
  await expect(page.getByRole('status').filter({ hasText: 'Adobe XFA layer' })).toBeVisible();
  const layer = fieldLayer(page);
  await layer.getByRole('textbox', { name: 'text1' }).fill('Hybrid works');
  await layer.getByRole('checkbox', { name: 'check1' }).check();
  const panel = await fieldsPanel(page);
  await expect(
    panel.getByRole('button', { name: 'text1, Text, page 1: Hybrid works' }),
  ).toBeVisible();
});

// The values the app's controls hold, downloaded through the export dialog (Sprint 4).
test('the filled values export flattened @all-engines', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/acroform-all.pdf');
  await renderedPage(page, 1);
  const layer = fieldLayer(page);
  await layer.getByRole('textbox', { name: 'text1' }).fill('Ada Lovelace');
  await layer.getByRole('textbox', { name: 'multiline1' }).fill('First line');
  await layer.getByRole('textbox', { name: 'comb1' }).fill('123456789');
  await layer.getByRole('checkbox', { name: 'check1' }).check();
  await layer.getByRole('radio', { name: 'radio1: c' }).check();
  await layer.getByRole('combobox', { name: 'dropdown1' }).selectOption('Gamma');
  await layer.getByRole('listbox', { name: 'list1' }).selectOption(['One', 'Three']);

  const values = {
    text1: await layer.getByRole('textbox', { name: 'text1' }).inputValue(),
    multiline1: await layer.getByRole('textbox', { name: 'multiline1' }).inputValue(),
    comb1: await layer.getByRole('textbox', { name: 'comb1' }).inputValue(),
    check1: await layer.getByRole('checkbox', { name: 'check1' }).isChecked(),
    radio1: (await layer.getByRole('radio', { name: 'radio1: c' }).isChecked()) ? 'c' : '',
    dropdown1: await layer.getByRole('combobox', { name: 'dropdown1' }).inputValue(),
    list1: await selected(layer.getByRole('listbox', { name: 'list1' })),
  };
  expect(values).toEqual({
    text1: 'Ada Lovelace',
    multiline1: 'First line',
    comb1: '123456789',
    check1: true,
    radio1: 'c',
    dropdown1: 'Gamma',
    list1: ['One', 'Three'],
  });

  const { bytes } = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  const out = await readFlattened(bytes);
  expect(out.fields).toBe(0);
  for (const text of ['Ada Lovelace', 'First line', 'Gamma', 'Fixed value']) {
    expect(out.draws(text), text).toBe(true);
  }
  await openExport(page, bytes);
  await expect(fieldLayer(page)).toHaveCount(0);
  expect(await inkInBox(page, 1, inner([180, 498, 195, 513]), 792)).toBeGreaterThan(0.05);
});

test('the W-9 exports Other and 3b checked', async ({ page }) => {
  test.skip(!fetched('fetched/irs/fw9.pdf'), 'run pnpm fixtures:fetch');
  await page.goto('/');
  await openFixture(page, 'fetched/irs/fw9.pdf');
  await renderedPage(page, 1);
  const layer = fieldLayer(page);
  const other = 'topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[6]';
  const b3 = 'topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_2[0]';
  const ssn = 'topmostSubform[0].Page1[0].f1_13[0]';
  await layer.getByRole('checkbox', { name: 'c1_1[6]' }).check();
  await layer.getByRole('checkbox', { name: 'c1_2[0]' }).check();
  await layer.getByRole('textbox', { name: 'f1_13[0]' }).fill('6789');
  await layer.getByRole('textbox', { name: 'f1_01[0]' }).fill('Tim Howland');
  const values = {
    [other]: await layer.getByRole('checkbox', { name: 'c1_1[6]' }).isChecked(),
    [b3]: await layer.getByRole('checkbox', { name: 'c1_2[0]' }).isChecked(),
    [ssn]: await layer.getByRole('textbox', { name: 'f1_13[0]' }).inputValue(),
    'topmostSubform[0].Page1[0].f1_01[0]': await layer
      .getByRole('textbox', { name: 'f1_01[0]' })
      .inputValue(),
  };
  expect(values[other]).toBe(true);
  expect(values[b3]).toBe(true);

  const { bytes } = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  const out = await readFlattened(bytes);
  expect(out.fields).toBe(0);
  expect(out.draws('Tim Howland')).toBe(true);
  await openExport(page, bytes);
  const height = 791.968;
  const otherInk = await inkInBox(page, 1, inner([73, 554, 81, 562]), height);
  const b3Ink = await inkInBox(page, 1, inner([441, 521, 449, 529]), height);
  const individualInk = await inkInBox(page, 1, inner([73, 604, 81, 612]), height);
  expect(otherInk).toBeGreaterThan(individualInk + 0.05);
  expect(b3Ink).toBeGreaterThan(individualInk + 0.05);
});
