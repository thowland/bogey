// Builders for small in-memory PDFs, so core tests run unchanged in Node and in every browser.
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type { FieldDescriptor, PdfInfo } from '../src/index.ts';

export const base64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A 1 × 1 opaque red PNG. */
export const PNG_1PX = base64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
);

/** A 1 × 1 baseline JPEG. */
export const JPEG_1PX = base64(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxgRQyoYEII0KRobEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAgBAQAAPwD3+iiigD//2Q==',
);

export interface FormSpec {
  rotate?: number;
  xfa?: boolean;
  needsRendering?: boolean;
  encrypt?: { user?: string; owner: string };
  javascript?: boolean;
  title?: string;
}

/** A one-page Letter document with one of every field type and the given extras. */
export async function makeForm(spec: FormSpec = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(spec.title ?? 'Test form');
  doc.setAuthor('Bogey tests');
  const page = doc.addPage([612, 792]);
  if (spec.rotate) page.setRotation(degrees(spec.rotate));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Static text', { x: 72, y: 740, size: 12, font });
  const form = doc.getForm();
  form.createTextField('name').addToPage(page, { x: 100, y: 700, width: 200, height: 20, font });
  const comb = form.createTextField('zip');
  comb.setMaxLength(5);
  comb.enableCombing();
  comb.addToPage(page, { x: 100, y: 660, width: 100, height: 20, font });
  const multi = form.createTextField('notes');
  multi.enableMultiline();
  multi.addToPage(page, { x: 100, y: 560, width: 200, height: 80, font });
  form.createCheckBox('agree').addToPage(page, { x: 100, y: 520, width: 12, height: 12 });
  const radio = form.createRadioGroup('choice');
  radio.addOptionToPage('a', page, { x: 100, y: 480, width: 12, height: 12 });
  radio.addOptionToPage('b', page, { x: 140, y: 480, width: 12, height: 12 });
  const dropdown = form.createDropdown('pick');
  dropdown.addOptions(['Alpha', 'Beta']);
  dropdown.addToPage(page, { x: 100, y: 440, width: 120, height: 20, font });
  const list = form.createOptionList('many');
  list.addOptions(['One', 'Two', 'Three']);
  list.enableMultiselect();
  list.addToPage(page, { x: 100, y: 360, width: 120, height: 60, font });
  const fixed = form.createTextField('fixed');
  fixed.setText('Locked');
  fixed.enableReadOnly();
  fixed.addToPage(page, { x: 100, y: 320, width: 200, height: 20, font });
  form.createButton('press').addToPage('Go', page, { x: 100, y: 280, width: 60, height: 20, font });
  if (spec.javascript) addActiveContent(doc, page);
  let bytes = await doc.save({ useObjectStreams: false });
  if (spec.xfa || spec.needsRendering) {
    const again = await PDFDocument.load(bytes, { preserveXFA: true, updateMetadata: false });
    if (spec.xfa) {
      again
        .getForm()
        .acroForm.dict.set(
          PDFName.of('XFA'),
          again.context.register(
            again.context.stream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>'),
          ),
        );
    }
    if (spec.needsRendering)
      again.catalog.set(PDFName.of('NeedsRendering'), again.context.obj(true));
    bytes = await again.save({ useObjectStreams: false });
  }
  if (spec.encrypt) {
    const enc = await PDFDocument.load(bytes, { updateMetadata: false });
    enc.encrypt({
      userPassword: spec.encrypt.user ?? '',
      ownerPassword: spec.encrypt.owner,
      permissions: {},
    });
    bytes = await enc.save({ useObjectStreams: false });
  }
  return bytes;
}

function addActiveContent(doc: PDFDocument, page: PDFPage) {
  const ctx = doc.context;
  const js = ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
  doc.catalog.set(PDFName.of('OpenAction'), ctx.register(js));
  doc.catalog.set(PDFName.of('AA'), ctx.obj({ WC: js }));
  page.node.set(PDFName.of('AA'), ctx.obj({ O: js }));
  const names = ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('a'), ctx.register(js)] }) });
  doc.catalog.set(PDFName.of('Names'), names);
  const link = ctx.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [10, 10, 50, 50],
    A: ctx.obj({ S: 'Launch', F: PDFString.of('calc.exe') }),
    AA: ctx.obj({ E: js }),
  });
  page.node.addAnnot(ctx.register(link));
}

/** Flat pages with the given rotations (Letter, or a custom media and crop box). */
export async function makePages(
  rotations: number[],
  box?: { media: [number, number]; crop?: [number, number, number, number] },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Pages');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const rotation of rotations) {
    const page = doc.addPage(box?.media ?? [612, 792]);
    if (box?.crop) page.setCropBox(...box.crop);
    page.setRotation(degrees(rotation));
    page.drawText(`Rotation ${rotation}`, { x: 100, y: 100, size: 10, font });
  }
  return doc.save();
}

export const field = (
  f: Partial<FieldDescriptor> & Pick<FieldDescriptor, 'name' | 'kind'>,
): FieldDescriptor => ({
  supported: f.kind !== 'button' && f.kind !== 'signature',
  readOnly: false,
  required: false,
  fontSize: 0,
  textAlign: 'left',
  widgets: [{ page: 0, rect: [0, 0, 100, 20], mkRotation: 0 }],
  tabOrder: 0,
  ...f,
});

export const info = (fields: FieldDescriptor[], pageCount = 2): PdfInfo => ({
  formType: fields.length > 0 ? 'acroform' : 'flat',
  xfa: 'none',
  encrypted: false,
  decryptable: true,
  pageCount,
  pages: Array.from({ length: pageCount }, (_, index) => ({
    index,
    view: [0, 0, 612, 792] as const,
    rotate: 0 as const,
    userUnit: 1,
  })),
  fields,
  initialValues: {},
  metadata: {},
});
