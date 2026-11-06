// Documents kept in the browser (Sprint 6): autosave and restore (M1, D7, acceptance 3), the
// encrypted restore, the recent list's cap (D6) and Clear everything (S7), under the production
// headers. Tests under the violation fixture take no screenshots.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  activeDocumentId,
  expect,
  openFixture,
  openFixtureAs,
  openSealedRecord,
  patchRecord,
  renderedPage,
  savedByteCount,
  savedRecords,
  sealRecordEdits,
  test,
  waitForSaved,
  watchViolations,
} from './helpers.ts';

const MULTIPAGE = 'vendored/generated/multipage-rotations.pdf';
const ENCRYPTED = 'vendored/generated/acroform-all-aes256.pdf';

// Sprints 4 and 5 add the overlay and field UI; until then the edits of an earlier session are
// written into the record directly, and the test checks they come back into the app's edit state
// (the next autosave writes them out again rather than an empty state).
const EDITS = {
  fieldValues: { 'applicant.name': 'Jane Doe' },
  overlays: [
    {
      id: 'e2e-text',
      type: 'text',
      page: 2,
      x: 72,
      y: 600,
      text: 'Jane Doe',
      size: 12,
      bold: false,
    },
  ],
};

async function chooseZoom(page: Page, label: string) {
  await page.getByRole('button', { name: /Zoom level/ }).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(page.getByRole('button', { name: `Zoom level: ${label}` })).toBeVisible();
}

/** Opens the multipage fixture, moves to page 3 at 150%, and seeds an earlier session's edits. */
async function startEditing(page: Page) {
  await openFixture(page, MULTIPAGE);
  await renderedPage(page, 1);
  const { id } = await waitForSaved(page, 'multipage-rotations.pdf');
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await chooseZoom(page, '150%');
  await expect.poll(async () => (await savedRecords(page))[0]?.zoom).toBe(1.5);
  await patchRecord(page, id, EDITS);
  return id;
}

/** Checks that the document came back at page 3, 150%, with its edits. */
async function expectRestored(page: Page, id: string) {
  await expect(page.getByText('Page 3 of 4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom level: 150%' })).toBeVisible();
  await renderedPage(page, 3);
  // Any change makes the next autosave write the edit state the app now holds.
  await page.keyboard.press('[');
  await expect
    .poll(async () => (await savedRecords(page)).find((record) => record.id === id)?.lastPage)
    .toBe(1);
  const saved = (await savedRecords(page)).find((record) => record.id === id)!;
  expect(saved.fieldValues).toEqual(EDITS.fieldValues);
  expect(saved.overlays).toEqual(EDITS.overlays);
  expect(saved.hasThumbnail).toBe(true);
}

test('reloading mid-edit restores the page, zoom, values and overlays (acceptance 3) @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  const id = await startEditing(page);
  await page.reload();
  await expectRestored(page, id);
});

test('closing and reopening the browser restores the document (acceptance 3) @all-engines', async ({
  browserName,
  playwright,
  baseURL,
}) => {
  const profile = mkdtempSync(join(tmpdir(), `bogey-e2e-${browserName}-`));
  const launch = () =>
    playwright[browserName].launchPersistentContext(profile, baseURL ? { baseURL } : {});
  try {
    let context = await launch();
    let page = context.pages()[0] ?? (await context.newPage());
    let violations = watchViolations(page, browserName);
    await page.goto('/');
    const id = await startEditing(page);
    await context.close();
    expect(violations).toEqual([]);

    context = await launch();
    page = context.pages()[0] ?? (await context.newPage());
    violations = watchViolations(page, browserName);
    await page.goto('/');
    await expectRestored(page, id);
    await context.close();
    expect(violations).toEqual([]);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('the encrypted fixture asks for its password again after a reload @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page, ENCRYPTED, 'bogey');
  await renderedPage(page, 1);
  const saved = await waitForSaved(page, 'acroform-all-aes256.pdf');
  // No image of a password-protected page is kept where the password is not needed to read it.
  expect(saved.hasThumbnail).toBe(false);
  await page.reload();

  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('acroform-all-aes256.pdf');
  // Cancel shows the recent list with the document still in it.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const item = page.getByRole('button', { name: /Password-protected acroform-all-aes256\.pdf/ });
  await expect(item).toBeVisible();
  await expect(page.getByRole('img', { name: 'Password-protected' })).toBeVisible();

  await item.click();
  await dialog.getByLabel('Password').fill('bogey');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await renderedPage(page, 1);
  // The password is held in memory only.
  expect(JSON.stringify(await savedRecords(page))).not.toContain('"bogey"');
});

test('a 21st document evicts the least recently updated one (D6)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  for (let n = 1; n <= 21; n++) {
    await openFixtureAs(page, 'vendored/generated/flat-single.pdf', `doc-${n}.pdf`);
    await waitForSaved(page, `doc-${n}.pdf`);
  }
  const names = (await savedRecords(page)).map((record) => record.name);
  expect(names).toHaveLength(20);
  expect(names).not.toContain('doc-1.pdf');
  expect(names[0]).toBe('doc-21.pdf');
  expect(await savedByteCount(page)).toBe(20);

  // The recent list shows when no document is open; deleting from it removes record and bytes.
  await page.getByTestId('open-input').setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('These are notes, not a PDF.'),
  });
  const recent = page.getByRole('region', { name: 'Recent documents' });
  await expect(recent.getByRole('listitem')).toHaveCount(20);
  await recent.getByRole('button', { name: 'Delete doc-2.pdf' }).click();
  await expect(recent.getByRole('listitem')).toHaveCount(19);
  await expect.poll(() => savedByteCount(page)).toBe(19);
});

test('Clear everything leaves an empty app after the reload (S7) @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page, 'vendored/generated/flat-single.pdf');
  await renderedPage(page, 1);
  await waitForSaved(page, 'flat-single.pdf');

  await page.locator('header').getByRole('button', { name: 'Clear everything' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Clear everything?' });
  await dialog.getByRole('button', { name: 'Clear everything' }).click();

  await expect(page.getByText('Documents you open will be listed here.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible();
  await expect.poll(() => savedRecords(page)).toEqual([]);
  expect(await activeDocumentId(page)).toBeNull();
  expect(await savedByteCount(page)).toBe(0);
});

test('the edits of a password-protected document are sealed at rest and come back with the password @all-engines', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const marker = 'SSN-123-45-6789';
  const edits = {
    fieldValues: { 'text.single': marker },
    overlays: [
      { id: 'e2e-ssn', type: 'text', page: 0, x: 72, y: 500, text: marker, size: 12, bold: false },
    ],
  };
  await page.goto('/');
  await openFixture(page, ENCRYPTED, 'bogey');
  await renderedPage(page, 1);
  const { id } = await waitForSaved(page, 'acroform-all-aes256.pdf');
  // The first save seals an empty edit state and fixes the document's salt.
  await expect
    .poll(async () => (await openSealedRecord(page, id, 'bogey')).edits)
    .toEqual({
      fieldValues: {},
      overlays: [],
    });
  await sealRecordEdits(page, id, 'bogey', edits);

  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await dialog.getByLabel('Password').fill('bogey');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await renderedPage(page, 1);

  // A change makes the next autosave seal the edit state the app restored.
  const before = (await openSealedRecord(page, id, 'bogey')).updatedAt;
  await chooseZoom(page, '150%');
  await expect
    .poll(async () => (await openSealedRecord(page, id, 'bogey')).updatedAt)
    .not.toBe(before);
  const stored = await openSealedRecord(page, id, 'bogey');
  expect(stored.edits).toEqual(edits);
  expect(stored.text).not.toContain(marker);
  expect(stored.text).not.toContain('bogey');
  await expect(page.getByText('could not be unlocked')).toHaveCount(0);
});
