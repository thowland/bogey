// Output hygiene (spec §9.1 steps 4 and 6, §11.4): no document JavaScript, no additional actions,
// no leftover encryption dictionaries.
import { PDFDict, PDFName, PDFRawStream, PDFStream, type PDFDocument } from '@cantoo/pdf-lib';
import { get, getArray, getDict } from '../inspect/pdfObjects.ts';

const N = PDFName.of;

/** Removes `/Names /JavaScript`, an action `/OpenAction`, and every `/AA` (spec §9.1 step 4). */
export function stripActiveContent(doc: PDFDocument): void {
  const catalog = doc.catalog;
  const names = getDict(catalog, 'Names');
  names?.delete(N('JavaScript'));
  // A destination array (go to a page) is harmless; an action dictionary is not kept.
  if (get(catalog, 'OpenAction') instanceof PDFDict) catalog.delete(N('OpenAction'));
  catalog.delete(N('AA'));
  for (const page of doc.getPages()) {
    page.node.delete(N('AA'));
    const annots = getArray(page.node, 'Annots');
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      annot.delete(N('AA'));
      const action = getDict(annot, 'A');
      const kind = action ? get(action, 'S') : undefined;
      if (kind === N('JavaScript') || kind === N('Launch')) annot.delete(N('A'));
    }
  }
}

/**
 * The fork decrypts objects but keeps the original's cross-reference streams and encryption
 * dictionary as ordinary objects, so the saved file still names `/Encrypt` (found in the Sprint 2
 * spike). Removes them so the output is unambiguously unencrypted (E9).
 */
export function removeEncryptionLeftovers(doc: PDFDocument): void {
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : undefined;
    if (!dict) continue;
    const type = get(dict, 'Type');
    const isXref = object instanceof PDFRawStream && type === N('XRef');
    const isEncrypt = get(dict, 'Filter') === N('Standard') && dict.has(N('O')) && dict.has(N('U'));
    if (isXref || isEncrypt) doc.context.delete(ref);
  }
}
