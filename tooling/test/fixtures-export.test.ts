// Export verification (spec §14.4) on the fixture classes, read back with pdf-lib and pdf.js; the
// upright-frame property and pdf.js PageViewport agreement (spec §14.3); the export budget (E7).
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PRODUCER,
  exportPdf,
  inspectPdf,
  pdfToScreen,
  type DocumentEditState,
  type FieldValue,
  type Overlay,
  type PdfInfo,
  type Rotation,
} from '../../packages/core/src/index.ts';
import {
  entry,
  fixture,
  manifest,
  pageText,
  pageViewportClass,
  present,
  textItems,
  type TextItem,
} from './pdfCore.ts';

async function inspect(path: string, password?: string): Promise<PdfInfo> {
  const r = await inspectPdf(fixture(path), password ? { password } : {});
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
}

async function exportFixture(path: string, state: DocumentEditState, password?: string) {
  const info = await inspect(path, password);
  const r = await exportPdf({
    bytes: fixture(path),
    ...(password ? { password } : {}),
    info,
    state,
    signatures: new Map(),
    options: { replaceNonWinAnsi: false, now: Date.UTC(2026, 10, 6) },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return { info, bytes: r.value.bytes };
}

/** The pdf-lib half of §14.4. */
async function checkStructure(
  bytes: Uint8Array,
  original: Uint8Array,
  pageCount: number,
  password?: string,
) {
  const out = await PDFDocument.load(bytes, { updateMetadata: false, preserveXFA: true });
  const before = await PDFDocument.load(original, {
    updateMetadata: false,
    ...(password !== undefined ? { password } : {}),
  });
  expect(out.isEncrypted).toBe(false);
  expect(out.getPageCount()).toBe(pageCount);
  expect(out.getForm().getFields()).toHaveLength(0);
  expect(out.getForm().acroForm.dict.get(PDFName.of('XFA'))).toBeUndefined();
  expect(out.getProducer()).toBe(PRODUCER);
  expect(out.getTitle()).toBe(before.getTitle());
  expect(out.getAuthor()).toBe(before.getAuthor());
  const names = out.catalog.lookupMaybe(
    PDFName.of('Names'),
    (await import('@cantoo/pdf-lib')).PDFDict,
  );
  expect(names?.get(PDFName.of('JavaScript'))).toBeUndefined();
  expect(new TextDecoder('latin1').decode(bytes)).not.toMatch(/\/JavaScript|\/Encrypt/);
}

const find = (items: TextItem[], str: string) => items.find((i) => i.str.includes(str));

const textOverlay = (id: string, page: number, x: number, y: number, text: string): Overlay => ({
  id,
  type: 'text',
  page,
  x,
  y,
  text,
  size: 12,
  bold: false,
});

describe('export verification (spec §14.4)', () => {
  it('fills and flattens every field type of the generated AcroForm', async () => {
    const path = 'fixtures/vendored/generated/acroform-all.pdf';
    const values: Record<string, FieldValue> = {
      text1: 'Filled text',
      multiline1: 'Line A\nLine B',
      comb1: '123456789',
      check1: true,
      radio1: 'b',
      dropdown1: 'Beta',
      list1: ['Two', 'Four'],
    };
    const { info, bytes } = await exportFixture(path, {
      fieldValues: values,
      overlays: [textOverlay('o', 0, 400, 100, 'Overlay text')],
    });
    await checkStructure(bytes, fixture(path), 1);
    const items = (await textItems(bytes))[0]!;
    for (const [name, expected] of [
      ['text1', 'Filled text'],
      ['multiline1', 'Line A'],
      ['dropdown1', 'Beta'],
      ['readonly1', 'Fixed value'],
    ] as const) {
      const rect = info.fields.find((f) => f.name === name)!.widgets[0]!.rect;
      const item = find(items, expected);
      expect(item, name).toBeDefined();
      const [, , , , x, y] = item!.transform;
      expect(
        x! >= rect[0] - 1 && x! <= rect[2] + 1 && y! >= rect[1] - 1 && y! <= rect[3] + 1,
        name,
      ).toBe(true);
    }
    expect(pageText(items).replace(/\s/g, '')).toContain('123456789');
    const overlay = find(items, 'Overlay text')!;
    expect(overlay.transform[4]).toBeCloseTo(400, 2);
    expect(overlay.transform[5]).toBeCloseTo(100, 2);
  });

  it('removes the XFA layer of the hybrid fixture and fills its AcroForm (D4)', async () => {
    const path = 'fixtures/vendored/generated/xfa-hybrid.pdf';
    const { bytes } = await exportFixture(path, {
      fieldValues: { text1: 'Hybrid value' },
      overlays: [],
    });
    await checkStructure(bytes, fixture(path), 1);
    expect(pageText((await textItems(bytes))[0]!)).toContain('Hybrid value');
  });

  it('exports the encrypted AcroForm unencrypted with its values (E9)', async () => {
    const path = 'fixtures/vendored/generated/acroform-all-aes256.pdf';
    const { bytes } = await exportFixture(
      path,
      { fieldValues: { text1: 'Secret value' }, overlays: [] },
      'bogey',
    );
    await checkStructure(bytes, fixture(path), 1, 'bogey');
    expect(pageText((await textItems(bytes))[0]!)).toContain('Secret value');
  });

  const irs = 'fixtures/fetched/irs/fw9.pdf';
  it.runIf(present(entry(irs)))('fills the IRS W-9 hybrid form', async () => {
    const info = await inspect(irs);
    const first = info.fields.find(
      (f) => f.kind === 'text' && !f.readOnly && f.maxLength === undefined,
    )!;
    const { bytes } = await exportFixture(irs, {
      fieldValues: { [first.name]: 'Jane Q Public' },
      overlays: [],
    });
    await checkStructure(bytes, fixture(irs), entry(irs).pageCount);
    expect(pageText((await textItems(bytes))[first.widgets[0]!.page]!)).toContain('Jane Q Public');
  });

  // X5 and spec §14.3 "upright frame": on every page of every registration-mark fixture, a text
  // overlay placed at a mark comes back from pdf.js with its origin there and its direction
  // matching the page rotation.
  const markFixtures = manifest.filter((e) => e.marks !== undefined);
  for (const e of markFixtures) {
    it(`places overlays on the registration marks of ${e.path}`, async () => {
      const marks = e.marks!;
      const overlays = marks.map((m, i) => textOverlay(`m${i}`, m.page, m.x, m.y, `MARK${i}X`));
      const { info, bytes } = await exportFixture(e.path, { fieldValues: {}, overlays });
      const pages = await textItems(bytes);
      marks.forEach((m, i) => {
        const item = find(pages[m.page]!, `MARK${i}X`)!;
        const [a, b, , , x, y] = item.transform as [number, number, number, number, number, number];
        expect(Math.abs(x - m.x)).toBeLessThan(0.01);
        expect(Math.abs(y - m.y)).toBeLessThan(0.01);
        const r = (info.pages[m.page]!.rotate * Math.PI) / 180;
        expect(a / 12).toBeCloseTo(Math.cos(r), 6);
        expect(b / 12).toBeCloseTo(Math.sin(r), 6);
      });
    });
  }

  it('draws multi-line text one line height apart in the upright frame', async () => {
    const path = 'fixtures/vendored/generated/multipage-rotations.pdf';
    const overlays = [0, 1, 2, 3].map((page) =>
      textOverlay(`t${page}`, page, 306, 396, `TOP${page}\nLOW${page}`),
    );
    const { info, bytes } = await exportFixture(path, { fieldValues: {}, overlays });
    const pages = await textItems(bytes);
    for (const page of [0, 1, 2, 3]) {
      const geometry = info.pages[page]!;
      const top = find(pages[page]!, `TOP${page}`)!.transform;
      const low = find(pages[page]!, `LOW${page}`)!.transform;
      const sTop = pdfToScreen(geometry, { x: top[4]!, y: top[5]! }, 1);
      const sLow = pdfToScreen(geometry, { x: low[4]!, y: low[5]! }, 1);
      // On screen, the second line sits straight below the first: 1.2 × 12 pt = 14.4 pt lower.
      expect(sLow.x - sTop.x).toBeCloseTo(0, 6);
      expect(sLow.y - sTop.y).toBeCloseTo(14.4 * (96 / 72), 6);
    }
  });

  it('exports the 20-page, 10 MB fixture within 5 s (E7)', async () => {
    const path = 'fixtures/vendored/generated/large-20p.pdf';
    const info = await inspect(path);
    const overlays = info.pages.map((p, i) => textOverlay(`p${i}`, i, 72, 72, `Page ${i + 1}`));
    const start = performance.now();
    const r = await exportPdf({
      bytes: fixture(path),
      info,
      state: { fieldValues: {}, overlays },
      signatures: new Map(),
      options: { replaceNonWinAnsi: false, now: 0 },
    });
    const ms = performance.now() - start;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(5_000);
  });
});

describe('agreement with pdf.js (spec §14.3)', () => {
  it('pdfToScreen equals PageViewport.convertToViewportPoint within 1e-6 CSS px', async () => {
    const PageViewport = await pageViewportClass();
    const rotations: Rotation[] = [0, 90, 180, 270];
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.constantFrom(...rotations),
        fc.constantFrom(1, 2),
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (x0, y0, w, h, rotate, userUnit, zoom, fx, fy) => {
          const page = { index: 0, view: [x0, y0, x0 + w, y0 + h] as const, rotate, userUnit };
          const viewport = new PageViewport({
            viewBox: [x0, y0, x0 + w, y0 + h],
            userUnit,
            scale: zoom * (96 / 72),
            rotation: rotate,
          });
          const p = { x: x0 + fx * w, y: y0 + fy * h };
          const [u, v] = viewport.convertToViewportPoint(p.x, p.y);
          const ours = pdfToScreen(page, p, zoom);
          expect(Math.abs(ours.x - u!)).toBeLessThan(1e-6);
          expect(Math.abs(ours.y - v!)).toBeLessThan(1e-6);
        },
      ),
    );
  });
});
