// The README's screenshots (`pnpm screenshots`): the IRS W-9 and W-4 filled in for an imaginary
// taxpayer, run against the production build and written to docs/images/. Marisol Quintero, her
// press, her client and her employer are made up. Her SSN is from the block the Social Security
// Administration reserves for advertising (987-65-4320 to 4329), the phone numbers are 555-01xx,
// and the email domain is reserved.
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { fixture, pageArea, renderedPage } from '../../e2e/helpers.ts';

const OUT = new URL('../../docs/images/', import.meta.url).pathname;
const RAW = new URL('../../test-results/screenshots/', import.meta.url).pathname;

/** Screenshots the page and writes it to docs/images as WebP (cwebp, from `brew install webp`). */
async function shoot(page: Page, name: string) {
  const png = `${RAW}${name}.png`;
  await page.screenshot({ path: png });
  execFileSync('cwebp', ['-quiet', '-q', '90', png, '-o', `${OUT}${name}.webp`]);
}

const PERSON = {
  name: 'Marisol J. Quintero',
  first: 'Marisol J.',
  last: 'Quintero',
  business: 'Quintero Letterpress',
  street: '418 Juniper Hollow Road',
  unit: 'Studio B',
  town: 'Fernwick, VT 05999',
  phone: '(802) 555-0143',
  email: 'marisol@example.com',
  ssn: ['987', '65', '4321'] as const,
};
const CLIENT = 'Larkspur Press Co-op\n9 Orchard Row\nFernwick, VT 05999';
const EMPLOYER = 'Harrow & Finch Bindery\n22 Mill Street, Fernwick, VT 05999';

const panel = (page: Page) =>
  page.getByRole('complementary', { name: /fields, snippets and signatures/i });
const field = (page: Page, name: string) =>
  page.locator(`[data-field-control][aria-label^="${name}"]`).first();

async function open(page: Page, file: 'fw9' | 'fw4') {
  await page.goto('/');
  await page.getByTestId('open-input').setInputFiles({
    name: `${file}.pdf`,
    mimeType: 'application/pdf',
    buffer: fixture(`fetched/irs/${file}.pdf`),
  });
  await renderedPage(page, 1);
  for (const name of ['Got it', 'Dismiss']) await page.getByRole('button', { name }).click();
}

async function snippets(page: Page) {
  const tab = panel(page);
  await tab.getByRole('tab', { name: 'Snippets' }).click();
  await tab.getByRole('button', { name: 'Edit snippets' }).click();
  // In the order of the seeded snippets: name, two address lines, city, phone, email.
  const values = [PERSON.name, PERSON.street, PERSON.unit, PERSON.town, PERSON.phone, PERSON.email];
  for (const [i, value] of values.entries())
    await tab
      .getByRole('group', { name: `Snippet ${i + 1}`, exact: true })
      .getByLabel('Value')
      .fill(value);
  await tab.getByRole('button', { name: 'Done' }).click();
}

async function useSnippet(page: Page, name: string, label: string) {
  await field(page, name).click();
  await panel(page)
    .getByRole('list', { name: 'Snippets' })
    .getByRole('button', { name: label, exact: true })
    .click();
}

/**
 * A handwritten-looking "MQuintero": loops along a slanted baseline (a prolate trochoid, the
 * shape of joined cursive e's), a capital M and Q before them and an underline after, sent as
 * pen strokes with the pressure rising and falling along each one.
 */
function signatureStrokes(width: number, height: number): [number, number, number][][] {
  const base = height * 0.62;
  const slant = (x: number, y: number): [number, number] => [x + (base - y) * 0.25, y];
  const smooth = (points: [number, number][], steps = 6) => {
    const out: [number, number][] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [p0, p1, p2, p3] = [
        points[i - 1] ?? points[i]!,
        points[i]!,
        points[i + 1]!,
        points[i + 2] ?? points[i + 1]!,
      ];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const f = (a: number, b: number, c: number, d: number) =>
          0.5 *
          (2 * b +
            (-a + c) * t +
            (2 * a - 5 * b + 4 * c - d) * t * t +
            (-a + 3 * b - 3 * c + d) * t ** 3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(points.at(-1)!);
    return out;
  };
  const h = height * 0.42;
  const x0 = width * 0.08;
  const m = smooth([
    [x0, base],
    [x0 + h * 0.15, base - h],
    [x0 + h * 0.35, base - h * 0.2],
    [x0 + h * 0.55, base - h * 0.95],
    [x0 + h * 0.75, base],
    [x0 + h * 0.9, base - h * 0.25],
  ]);
  const qx = x0 + h * 1.25;
  const q = smooth(
    Array.from({ length: 11 }, (_, i): [number, number] => {
      const a = Math.PI * 0.5 + (i / 10) * Math.PI * 2.05;
      return [qx + h * 0.42 * Math.cos(a), base - h * 0.5 - h * 0.5 * Math.sin(a)];
    }),
  );
  const tail = smooth([
    [qx + h * 0.1, base - h * 0.2],
    [qx + h * 0.35, base + h * 0.05],
    [qx + h * 0.6, base + h * 0.12],
  ]);
  const loops: [number, number][] = [];
  const lx = qx + h * 0.75;
  for (let t = 0; t <= Math.PI * 2 * 6.5; t += 0.25) {
    const r = h * (0.22 + 0.06 * Math.sin(t * 0.7));
    loops.push([lx + t * h * 0.075 - r * Math.sin(t), base - r * (1 - Math.cos(t))]);
  }
  const end = loops.at(-1)![0];
  const under = smooth([
    [x0 + h * 0.3, base + h * 0.42],
    [width * 0.45, base + h * 0.3],
    [end + h * 0.4, base + h * 0.12],
  ]);
  const pressure = (stroke: [number, number][]) =>
    stroke.map(([x, y], i): [number, number, number] => [
      ...slant(x, y),
      0.25 + 0.6 * Math.sin((Math.PI * (i + 1)) / (stroke.length + 1)),
    ]);
  return [m, q, tail, loops, under].map(pressure);
}

async function drawSignature(page: Page, name: string, shot?: string) {
  const tab = panel(page);
  await tab.getByRole('tab', { name: 'Signatures' }).click();
  await tab.getByRole('button', { name: 'Draw' }).click();
  const dialog = page.getByRole('dialog', { name: 'Draw a signature' });
  const pad = dialog.getByRole('img', { name: 'Signature drawing area' });
  const { width, height } = (await pad.boundingBox())!;
  await pad.evaluate(
    (element, strokes) => {
      const rect = element.getBoundingClientRect();
      const send = (type: string, [x, y, pressure]: [number, number, number], down: boolean) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: 'pen',
            isPrimary: true,
            clientX: rect.left + x,
            clientY: rect.top + y,
            pressure: down ? pressure : 0,
            buttons: down ? 1 : 0,
            button: type === 'pointermove' ? -1 : 0,
          }),
        );
      for (const stroke of strokes) {
        stroke.forEach((point, i) => send(i === 0 ? 'pointerdown' : 'pointermove', point, true));
        send('pointerup', stroke.at(-1)!, false);
      }
    },
    signatureStrokes(width, height),
  );
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  if (shot) await shoot(page, shot);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
}

/** Scrolls the page area by `dy` CSS px and returns the page's box afterwards. */
async function scrollBy(page: Page, dy: number) {
  const { layer, box } = await pageArea(page);
  // The page area's own scrolling, which works the same on a desktop and an emulated iPad.
  await layer.evaluate((element, by) => {
    let scroller = element.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight)
      scroller = scroller.parentElement;
    scroller?.scrollBy(0, by);
  }, dy);
  // Settled: two readings 200 ms apart agree, and the page has moved.
  let last = box.y;
  await expect
    .poll(
      async () => {
        const y = (await pageArea(page)).box.y;
        const settled = y === last && y !== box.y;
        last = y;
        return settled;
      },
      { intervals: [200] },
    )
    .toBe(true);
  return (await pageArea(page)).box;
}

/** Clicks a point given as fractions of the page's width and height. */
async function clickPage(page: Page, fx: number, fy: number) {
  const { box } = await pageArea(page);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Back to the Select tool with nothing selected or focused, as a person would leave it. */
async function settle(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test('W-9: snippets, a signature and the date @desktop', async ({ page }) => {
  await open(page, 'fw9');
  await snippets(page);
  await useSnippet(page, 'f1_01[0]', 'Full name');
  await field(page, 'f1_02[0]').fill(PERSON.business);
  await field(page, 'c1_1[0]').check();
  await useSnippet(page, 'f1_07[0]', 'Address line 1');
  await field(page, 'f1_09[0]').fill(CLIENT);
  await useSnippet(page, 'f1_08[0]', 'City/State/ZIP');
  await shoot(page, 'w9-fields');

  for (const [name, value] of [
    ['f1_11[0]', PERSON.ssn[0]],
    ['f1_12[0]', PERSON.ssn[1]],
    ['f1_13[0]', PERSON.ssn[2]],
  ] as const)
    await field(page, name).fill(value);
  await drawSignature(page, 'Marisol', 'draw-signature');
  await scrollBy(page, 640);
  await page.getByRole('button', { name: 'Place Marisol' }).click();
  await clickPage(page, 0.36, 0.75);
  await page.keyboard.press('d');
  await clickPage(page, 0.72, 0.745);
  await settle(page);
  await shoot(page, 'w9-signed');
});

test('W-4 on an iPad @ipad', async ({ page }) => {
  await open(page, 'fw4');
  await field(page, 'f1_01[0]').fill(PERSON.first);
  await field(page, 'f1_02[0]').fill(PERSON.last);
  await field(page, 'f1_05[0]').fill(PERSON.ssn.join('-'));
  await field(page, 'f1_03[0]').fill(PERSON.street);
  await field(page, 'f1_04[0]').fill(PERSON.town);
  await field(page, 'c1_1[0]').check();
  await field(page, 'f1_12[0]').fill(EMPLOYER);
  // Not the start date or the EIN: the W-4 puts those two fields across the bottom rule of the
  // form, so their text sits on the page footer, in Acrobat as here.
  await drawSignature(page, 'Marisol');
  await scrollBy(page, 10_000);
  await page.getByRole('button', { name: 'Place Marisol' }).click();
  await clickPage(page, 0.3, 0.875);
  await page.keyboard.press('d');
  await clickPage(page, 0.8, 0.882);
  await settle(page);
  await shoot(page, 'w4-ipad');
});
