// Export (spec §9, E1–E9): fill and flatten, draw overlays, strip active content, set metadata,
// save unencrypted and verify. The page-image path (spec §9.5) covers files the fork cannot decrypt.
import { PDFDocument, PDFName, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { loadPdf } from '../inspect/load.ts';
import { hasXfa } from '../inspect/index.ts';
import type { DocumentEditState, PdfInfo } from '../model/document.ts';
import type {
  ExportInput,
  ExportOutput,
  ExportProblem,
  ExportStage,
  ExportWarning,
  SignatureImage,
} from '../model/export.ts';
import type { FieldDescriptor } from '../model/fields.ts';
import { fail, ok, type Result } from '../result.ts';
import { nonWinAnsi, replaceNonWinAnsi } from '../text/index.ts';
import { fillAndFlatten } from './fields.ts';
import { removeEncryptionLeftovers, stripActiveContent } from './hygiene.ts';
import { drawOverlays } from './overlays.ts';

export { CHECK_GLYPH, X_MARK } from './overlays.ts';

/** Producer written into every export (E8). */
export const PRODUCER = 'Bogey';

/**
 * E4: every text and date overlay, and every overridden text or dropdown value, that contains
 * characters Helvetica cannot encode, with the characters and the page.
 */
export function preflightExport(
  state: DocumentEditState,
  fields: readonly FieldDescriptor[],
): ExportWarning[] {
  const warnings: ExportWarning[] = [];
  for (const overlay of state.overlays) {
    if (overlay.type !== 'text' && overlay.type !== 'date') continue;
    const characters = nonWinAnsi(overlay.text);
    if (characters.length > 0) {
      warnings.push({
        subject: { kind: 'overlay', id: overlay.id, page: overlay.page },
        characters,
      });
    }
  }
  for (const field of fields) {
    if (!field.supported || field.readOnly) continue;
    if (!Object.hasOwn(state.fieldValues, field.name)) continue;
    const value = state.fieldValues[field.name]!;
    const strings =
      typeof value === 'string'
        ? [field.kind === 'dropdown' ? labelOf(field, value) : value]
        : Array.isArray(value)
          ? value.map((v) => labelOf(field, v))
          : [];
    const characters = [...new Set(strings.flatMap(nonWinAnsi))];
    if (characters.length > 0) {
      warnings.push({
        subject: { kind: 'field', name: field.name, page: field.widgets[0]?.page ?? 0 },
        characters,
      });
    }
  }
  return warnings;
}

const labelOf = (field: FieldDescriptor, value: string) =>
  field.options?.find((o) => o.value === value)?.label ?? value;

type StageListener = (stage: ExportStage) => void;

function setMetadata(doc: PDFDocument, now: number, info?: PdfInfo['metadata']) {
  if (info?.title !== undefined) doc.setTitle(info.title);
  if (info?.author !== undefined) doc.setAuthor(info.author);
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date(now));
}

/** Step 8: the output must reload unencrypted, with the same pages and no form fields. */
async function verify(bytes: Uint8Array, pageCount: number): Promise<boolean> {
  try {
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    if (out.isEncrypted || out.getPageCount() !== pageCount) return false;
    return out.getForm().getFields().length === 0;
  } catch {
    return false;
  }
}

async function save(
  doc: PDFDocument,
  pageCount: number,
  stage: StageListener,
  rasterized: boolean,
): Promise<Result<ExportOutput, ExportProblem>> {
  stage('saving');
  removeEncryptionLeftovers(doc);
  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  stage('checking');
  if (!(await verify(bytes, pageCount))) return fail({ code: 'export.verify-failed' });
  return ok({ bytes, rasterized });
}

function textPolicy(
  input: Pick<ExportInput, 'state' | 'info' | 'options'>,
): Result<(s: string) => string, ExportProblem> {
  if (input.options.replaceNonWinAnsi) return ok(replaceNonWinAnsi);
  if (preflightExport(input.state, input.info.fields).length > 0) {
    return fail({ code: 'export.failed', data: { reason: 'non-winansi' } });
  }
  return ok((s: string) => s);
}

/** Exports the stored original with the user's edits (spec §9.1). */
export async function exportPdf(
  input: ExportInput,
  onStage: StageListener = () => undefined,
): Promise<Result<ExportOutput, ExportProblem>> {
  try {
    const text = textPolicy(input);
    if (!text.ok) return text;
    onStage('loading');
    const loaded = await loadPdf(input.bytes, {
      ...(input.password !== undefined ? { password: input.password } : {}),
      preserveXFA: true,
    });
    if (!loaded.ok) {
      const code = loaded.problems[0]!.code;
      return fail({
        code:
          code === 'pdf.password-wrong' || code === 'pdf.password-required'
            ? code
            : 'export.failed',
      });
    }
    const { doc, decryptable } = loaded.value;
    if (!decryptable || !input.info.decryptable) return fail({ code: 'export.cannot-decrypt' });
    const pageCount = doc.getPageCount();

    onStage('fields');
    // Hybrid XFA (spec §6.2): the XFA layer goes, so readers show the filled AcroForm. A dynamic
    // form's XFA goes too: the export shows what Bogey showed, the flat pages with overlays.
    if (hasXfa(doc)) doc.getForm().deleteXFA();
    doc.catalog.delete(PDFName.of('NeedsRendering'));
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    fillAndFlatten(
      doc,
      input.info.formType === 'acroform' ? input.info.fields : [],
      input.state,
      helvetica,
      text.value,
    );

    onStage('drawing');
    const drawn = await drawOverlays(input.state.overlays, {
      doc,
      pages: doc.getPages(),
      geometry: input.info.pages,
      signatures: input.signatures,
      text: text.value,
    });
    if (!drawn.ok) return drawn;
    stripActiveContent(doc);
    setMetadata(doc, input.options.now);
    return await save(doc, pageCount, onStage, false);
  } catch {
    return fail({ code: 'export.failed' });
  }
}

/** One page rendered upright-unrotated (pdf.js `rotation: 0`) over its view box, as JPEG. */
export interface PageImage {
  readonly jpeg: Uint8Array;
}

export interface ExportPageImagesInput {
  /** One image per page, in page order. */
  readonly pages: readonly PageImage[];
  readonly info: PdfInfo;
  readonly state: DocumentEditState;
  readonly signatures: ReadonlyMap<string, SignatureImage>;
  readonly options: ExportInput['options'];
}

/**
 * The fallback for originals the fork cannot decrypt (spec §9.5): a new document whose pages are
 * the rendered images, each on a page with the original's view box and rotation, so overlays keep
 * their stored coordinates; overlays are drawn on top. Field values are not drawn, since an
 * undecryptable file reports no fields.
 */
export async function exportPageImages(
  input: ExportPageImagesInput,
  onStage: StageListener = () => undefined,
): Promise<Result<ExportOutput, ExportProblem>> {
  try {
    if (input.pages.length !== input.info.pages.length) {
      return fail({ code: 'export.failed', data: { reason: 'page-images' } });
    }
    const text = textPolicy({ ...input, info: { ...input.info, fields: [] } });
    if (!text.ok) return text;
    onStage('loading');
    const doc = await PDFDocument.create({ updateMetadata: false });
    for (const [i, geometry] of input.info.pages.entries()) {
      const [x0, y0, x1, y1] = geometry.view;
      const page = doc.addPage([x1 - x0, y1 - y0]);
      page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
      page.setRotation(degrees(geometry.rotate));
      if (geometry.userUnit !== 1)
        page.node.set(PDFName.of('UserUnit'), doc.context.obj(geometry.userUnit));
      const image = await doc.embedJpg(input.pages[i]!.jpeg);
      page.drawImage(image, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    }
    onStage('drawing');
    const drawn = await drawOverlays(input.state.overlays, {
      doc,
      pages: doc.getPages(),
      geometry: input.info.pages,
      signatures: input.signatures,
      text: text.value,
    });
    if (!drawn.ok) return drawn;
    setMetadata(doc, input.options.now, input.info.metadata);
    return await save(doc, input.info.pages.length, onStage, true);
  } catch {
    return fail({ code: 'export.failed' });
  }
}
