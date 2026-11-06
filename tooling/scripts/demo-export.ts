// SPDX-License-Identifier: GPL-3.0-or-later
// Sprint 2 review aid (implementation plan, Sprint 2 Review):
//
//   pnpm demo:export
//
// Exports each fixture class with filled fields and overlays through @bogey/core, exactly as the
// pdf worker does, and writes the results to out/demo/ for checking in Preview and Acrobat
// Reader: field values flattened, overlay text on the registration marks of every rotated page,
// the encrypted fixture opening without a password, the hybrid XFA form showing its values.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { encode } from '@cantoo/pdf-lib/upng';
import {
  exportPdf,
  formatDate,
  inspectPdf,
  outputFileName,
  type FieldValue,
  type Overlay,
  type PageGeometry,
  type PdfInfo,
} from '../../packages/core/src/index.ts';

const root = new URL('../../', import.meta.url);
const outDir = new URL('out/demo/', root);

/** A blue scribble on transparent pixels, standing in for a drawn signature. */
function signaturePng(): Uint8Array {
  const w = 300;
  const h = 100;
  const rgba = new Uint8Array(w * h * 4);
  for (let x = 10; x < w - 10; x++) {
    const y = Math.round(h / 2 + 30 * Math.sin(x / 18) * Math.cos(x / 53));
    for (let dy = -2; dy <= 2; dy++) {
      const i = ((y + dy) * w + x) * 4;
      rgba.set([20, 40, 160, 255], i);
    }
  }
  return new Uint8Array(encode([rgba.buffer], w, h, 0));
}

const signatures = new Map([['demo', { png: signaturePng(), width: 300, height: 100 }]]);
const today = formatDate({ y: 2026, m: 11, d: 6 }, 'MM/DD/YYYY');

/** Overlays anchored at a page point: text, a date, a check, an X and a signature. */
function overlaySet(page: PageGeometry, at: { x: number; y: number }, tag: string): Overlay[] {
  const id = (s: string) => `${tag}-${s}-${page.index}`;
  return [
    {
      id: id('t'),
      type: 'text',
      page: page.index,
      ...at,
      text: `Text on page ${page.index + 1} (/Rotate ${page.rotate})\nsecond line`,
      size: 12,
      bold: false,
    },
    {
      id: id('d'),
      type: 'date',
      page: page.index,
      x: at.x,
      y: at.y,
      text: today,
      size: 10,
      bold: true,
    },
    { id: id('c'), type: 'check', page: page.index, x: at.x, y: at.y, glyph: 'check', size: 14 },
    { id: id('x'), type: 'check', page: page.index, x: at.x, y: at.y, glyph: 'x', size: 14 },
    {
      id: id('s'),
      type: 'signature',
      page: page.index,
      x: at.x,
      y: at.y,
      width: 150,
      height: 50,
      signatureId: 'demo',
    },
  ];
}

/** Spreads the overlay set out along the upright frame so the pieces do not overlap. */
function spread(page: PageGeometry, overlays: Overlay[]): Overlay[] {
  const r = (page.rotate * Math.PI) / 180;
  const down = { x: Math.sin(r), y: -Math.cos(r) };
  return overlays.map((o, i) =>
    i === 0 ? o : { ...o, x: o.x + down.x * 30 * (i + 1), y: o.y + down.y * 30 * (i + 1) },
  );
}

/** A value for every fillable field, so each kind shows up flattened. */
function fill(info: PdfInfo, limit = Infinity): Record<string, FieldValue> {
  const values: [string, FieldValue][] = [];
  for (const f of info.fields) {
    if (!f.supported || f.readOnly || values.length >= limit) continue;
    if (f.kind === 'text') {
      const sample = f.multiline
        ? 'Filled by Bogey\non two lines'
        : f.comb
          ? '123456789'
          : 'Filled by Bogey';
      values.push([f.name, f.maxLength ? [...sample].slice(0, f.maxLength).join('') : sample]);
    } else if (f.kind === 'checkbox') values.push([f.name, true]);
    else if (f.kind === 'radio' && f.onValues?.length) values.push([f.name, f.onValues.at(-1)!]);
    else if (f.kind === 'dropdown' && f.options?.length)
      values.push([f.name, f.options.at(-1)!.value]);
    else if (f.kind === 'list' && f.options?.length) values.push([f.name, [f.options[0]!.value]]);
  }
  return Object.fromEntries(values);
}

interface Demo {
  fixture: string;
  password?: string;
  /** Overlays at registration marks (from the manifest) or at a corner of each page. */
  marks?: boolean;
  fields?: boolean;
  fieldLimit?: number;
}

const DEMOS: Demo[] = [
  { fixture: 'fixtures/vendored/generated/flat-single.pdf', marks: true },
  { fixture: 'fixtures/vendored/generated/multipage-rotations.pdf', marks: true },
  { fixture: 'fixtures/vendored/generated/cropbox-offset-rotate-90.pdf', marks: true },
  { fixture: 'fixtures/vendored/generated/acroform-all.pdf', fields: true },
  {
    fixture: 'fixtures/vendored/generated/acroform-all-aes256.pdf',
    password: 'bogey',
    fields: true,
  },
  { fixture: 'fixtures/vendored/generated/xfa-hybrid.pdf', fields: true },
  { fixture: 'fixtures/vendored/generated/xfa-dynamic.pdf' },
  { fixture: 'fixtures/vendored/pdf-lib/fancy_fields.pdf', fields: true },
  { fixture: 'fixtures/fetched/irs/fw9.pdf', fields: true, fieldLimit: 12 },
  { fixture: 'fixtures/fetched/qpdf/enc-XI-R6,V5,U=view,O=master.pdf', password: 'view' },
];

interface ManifestEntry {
  path: string;
  marks?: { page: number; x: number; y: number }[];
}
const manifest = JSON.parse(
  readFileSync(new URL('fixtures/manifest.json', root), 'utf8'),
) as ManifestEntry[];

mkdirSync(outDir, { recursive: true });
let failures = 0;
for (const demo of DEMOS) {
  const source = new URL(demo.fixture, root);
  if (!existsSync(source)) {
    console.log(`skip   ${demo.fixture} (not fetched; run pnpm fixtures:fetch)`);
    continue;
  }
  const bytes = new Uint8Array(readFileSync(source));
  const inspected = await inspectPdf(bytes, demo.password ? { password: demo.password } : {});
  if (!inspected.ok) {
    console.log(`FAIL   ${demo.fixture}: ${JSON.stringify(inspected.problems)}`);
    failures++;
    continue;
  }
  const info = inspected.value;
  const marks = manifest.find((e) => e.path === demo.fixture)?.marks;
  const overlays = info.pages.flatMap((page) => {
    if (demo.marks && marks) {
      const mark = marks.filter((m) => m.page === page.index)[1] ?? marks[0]!;
      return spread(page, overlaySet(page, mark, 'm'));
    }
    if (demo.fields && page.index > 0) return [];
    const [x0, y0, x1, y1] = page.view;
    const corner = {
      0: { x: x0 + 40, y: y0 + 200 },
      90: { x: x1 - 200, y: y0 + 40 },
      180: { x: x1 - 40, y: y1 - 200 },
      270: { x: x0 + 200, y: y1 - 40 },
    }[page.rotate];
    return spread(page, overlaySet(page, corner, 'c')).slice(0, demo.fields ? 1 : 5);
  });
  const result = await exportPdf({
    bytes,
    ...(demo.password ? { password: demo.password } : {}),
    info,
    state: { fieldValues: demo.fields ? fill(info, demo.fieldLimit) : {}, overlays },
    signatures,
    options: { replaceNonWinAnsi: true, now: Date.now() },
  });
  if (!result.ok) {
    console.log(`FAIL   ${demo.fixture}: ${JSON.stringify(result.problems)}`);
    failures++;
    continue;
  }
  const name = outputFileName(demo.fixture.split('/').pop()!);
  writeFileSync(new URL(name, outDir), result.value.bytes);
  console.log(
    `wrote  out/demo/${name}  (${info.formType}${info.xfa !== 'none' ? `, XFA ${info.xfa}` : ''}${info.encrypted ? ', was encrypted' : ''}; ${overlays.length} overlays)`,
  );
}
process.exitCode = failures > 0 ? 1 : 0;
