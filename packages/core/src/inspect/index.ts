// Inspection (spec §6.2, §6.3, D4): form type, XFA kind, fields, page geometry, metadata and
// encryption state, read with the pdf-lib fork with XFA preserved.
import { PDFBool, PDFName, type PDFDocument } from '@cantoo/pdf-lib';
import { pageGeometry } from '../geometry/index.ts';
import type { FormType, PdfInfo, XfaKind } from '../model/document.ts';
import type { PageGeometry } from '../model/geometry.ts';
import { ok, type Problem, type Result } from '../result.ts';
import { enumerateFields, type EnumeratedFields } from './fields.ts';
import { loadPdf } from './load.ts';
import { get, getDict, getNumber, inherited, numbersOf } from './pdfObjects.ts';

export { hasPdfHeader, loadPdf } from './load.ts';
export type { Loaded, LoadOptions } from './load.ts';

export type InspectProblem = Problem;

const LETTER = [0, 0, 612, 792];

export function readPageGeometry(doc: PDFDocument): PageGeometry[] {
  return doc.getPages().map((page, index) => {
    const node = page.node;
    const rotate = inherited(node, 'Rotate');
    return pageGeometry({
      index,
      mediaBox: numbersOf(inherited(node, 'MediaBox')) ?? LETTER,
      cropBox: numbersOf(inherited(node, 'CropBox')),
      rotate: rotate && 'asNumber' in rotate ? (rotate as { asNumber(): number }).asNumber() : 0,
      userUnit: getNumber(node, 'UserUnit'),
    });
  });
}

function readMetadata(doc: PDFDocument): PdfInfo['metadata'] {
  const read = (f: () => string | undefined) => {
    try {
      const v = f();
      return v === undefined || v === '' ? undefined : v;
    } catch {
      return undefined;
    }
  };
  const title = read(() => doc.getTitle());
  const author = read(() => doc.getAuthor());
  return { ...(title !== undefined ? { title } : {}), ...(author !== undefined ? { author } : {}) };
}

/** Whether the catalog's AcroForm carries an `/XFA` entry. */
export function hasXfa(doc: PDFDocument): boolean {
  const acroForm = getDict(doc.catalog, 'AcroForm');
  return acroForm !== undefined && acroForm.get(PDFName.of('XFA')) !== undefined;
}

const needsRendering = (doc: PDFDocument) => get(doc.catalog, 'NeedsRendering') === PDFBool.True;

/**
 * The D4 table in spec §6.2. A widget placed on a page counts as usable even without an
 * appearance stream, because export generates missing appearances (§9.1 step 2.3); static XFA
 * forms from LiveCycle often ship their AcroForm copy that way.
 */
export function classify(
  xfaPresent: boolean,
  rendering: boolean,
  fieldCount: number,
): { formType: FormType; xfa: XfaKind } {
  const withWidgets = fieldCount > 0;
  if (!xfaPresent) return { formType: withWidgets ? 'acroform' : 'flat', xfa: 'none' };
  if (withWidgets && !rendering) return { formType: 'acroform', xfa: 'hybrid' };
  return { formType: 'xfa', xfa: 'dynamic' };
}

const NO_FIELDS: EnumeratedFields = { fields: [], initialValues: {} };

export async function inspectPdf(
  bytes: Uint8Array,
  opts: { password?: string } = {},
): Promise<Result<PdfInfo, InspectProblem>> {
  const loaded = await loadPdf(bytes, { ...opts, preserveXFA: true });
  if (!loaded.ok) return loaded;
  const { doc, encrypted, decryptable } = loaded.value;
  const pages = readPageGeometry(doc);
  let enumerated = NO_FIELDS;
  let kind: { formType: FormType; xfa: XfaKind } = { formType: 'flat', xfa: 'none' };
  if (decryptable) {
    try {
      enumerated = enumerateFields(doc);
    } catch {
      enumerated = NO_FIELDS;
    }
    kind = classify(hasXfa(doc), needsRendering(doc), enumerated.fields.length);
    // A dynamic XFA form's pages are treated as flat (D4).
    if (kind.formType !== 'acroform') enumerated = NO_FIELDS;
  }
  return ok({
    ...kind,
    encrypted,
    decryptable,
    pageCount: pages.length,
    pages,
    fields: enumerated.fields,
    initialValues: enumerated.initialValues,
    metadata: decryptable ? readMetadata(doc) : {},
  });
}
