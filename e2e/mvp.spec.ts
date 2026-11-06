// The MVP path end to end (implementation plan §2.2): an AcroForm document filled through its own
// field controls, signed with a drawn signature placed on the page, and downloaded through the
// export dialog. The download has no form fields left, shows the typed values as page text, and
// carries the signature image once.
import {
  download,
  drawSignature,
  expect,
  fieldLayer,
  letterPoint,
  openFixture,
  pageArea,
  readExport,
  renderedPage,
  test,
} from './helpers.ts';

test('fill an AcroForm, place a signature and download a flattened copy @all-engines', async ({
  page,
}) => {
  await page.goto('/');
  await drawSignature(page, 'Mine');
  await openFixture(page, 'vendored/generated/acroform-all.pdf');
  await renderedPage(page, 1);

  const fields = fieldLayer(page);
  await fields.getByRole('textbox', { name: 'text1' }).fill('Ada Lovelace');
  await fields.getByRole('textbox', { name: 'multiline1' }).fill('First line');
  await fields.getByRole('checkbox', { name: 'check1' }).check();
  await fields.getByRole('combobox', { name: 'dropdown1' }).selectOption('Gamma');

  const { box } = await pageArea(page);
  await page.getByRole('button', { name: 'Place Mine' }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + 120);
  await expect(
    page.getByRole('button', { name: 'Signature overlay: Mine, page 1', exact: true }),
  ).toBeVisible();

  const file = await download(page, () =>
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  );
  expect(file.name).toBe('acroform-all-signed.pdf');

  const out = await readExport(file.bytes);
  expect(out).toMatchObject({ pageCount: 1, fieldCount: 0, encrypted: false, producer: 'Bogey' });
  const text = out.text[0]!.map((item) => item.str).join(' ');
  for (const value of ['Ada Lovelace', 'First line', 'Gamma']) expect(text).toContain(value);
  expect(out.images[0]).toHaveLength(1);
  const [a, , , d, e, f] = out.images[0]![0]!;
  expect(a).toBeCloseTo(150, 2);
  const centre = letterPoint(box, 0, { x: box.width / 2, y: 120 });
  expect(Math.abs(e! + a! / 2 - centre.x)).toBeLessThan(1);
  expect(Math.abs(f! + d! / 2 - centre.y)).toBeLessThan(1);
});
