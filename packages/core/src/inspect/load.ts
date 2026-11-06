// Loading with the pdf-lib fork, decryption included (spec §6.1, §9.6). Shared by inspection and
// export so both treat passwords, damaged files and undecryptable files the same way.
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { fail, ok, type Result } from '../result.ts';
import { get } from './pdfObjects.ts';

const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** D1: readers look for `%PDF-` in the first 1,024 bytes, whatever the file name says. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 1024) - HEADER.length;
  for (let i = 0; i <= end; i++) {
    if (HEADER.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

export interface LoadOptions {
  password?: string;
  /** Inspection keeps XFA (spec §6.2); export of a hybrid form drops it. */
  preserveXFA: boolean;
}

export interface Loaded {
  doc: PDFDocument;
  encrypted: boolean;
  /** False when the fork cannot decrypt the file; `doc` is then the undecrypted structure. */
  decryptable: boolean;
}

/** UTF-8 bytes as a binary string: AES-256 R5 passwords are UTF-8, but the fork encodes as Latin-1. */
const utf8Binary = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

const isPasswordError = (e: unknown) =>
  e instanceof Error && /NEEDS PASSWORD|Password incorrect/i.test(e.message);

/**
 * Loads a document, decrypting with `password` (or the empty user password) when it is encrypted.
 * Problems: `pdf.damaged` for unparseable files, `pdf.password-required` when a password is needed
 * and none was given, `pdf.password-wrong` when the given one does not open it.
 */
export async function loadPdf(bytes: Uint8Array, opts: LoadOptions): Promise<Result<Loaded>> {
  if (!hasPdfHeader(bytes)) return fail({ code: 'file.not-pdf' });
  const base = { updateMetadata: false, preserveXFA: opts.preserveXFA } as const;
  let raw: PDFDocument;
  try {
    raw = await PDFDocument.load(bytes, { ...base, ignoreEncryption: true });
    // The parser recovers from almost anything; a document without a page tree is damaged.
    if (raw.getPageCount() === 0) return fail({ code: 'pdf.damaged' });
  } catch {
    return fail({ code: 'pdf.damaged' });
  }
  if (!raw.isEncrypted) return ok({ doc: raw, encrypted: false, decryptable: true });

  const candidates = [opts.password ?? ''];
  if (opts.password && utf8Binary(opts.password) !== opts.password) {
    candidates.push(utf8Binary(opts.password));
  }
  let passwordFailed = false;
  for (const password of candidates) {
    try {
      const doc = await PDFDocument.load(bytes, { ...base, password });
      if (doc.isEncrypted) break;
      return ok({ doc, encrypted: true, decryptable: decryptedContentLooksRight(doc) });
    } catch (e) {
      if (!isPasswordError(e)) break;
      passwordFailed = true;
    }
  }
  if (passwordFailed) {
    return fail({
      code: opts.password === undefined ? 'pdf.password-required' : 'pdf.password-wrong',
    });
  }
  // An unsupported security handler or a decryption failure: page geometry is unencrypted, so
  // inspection can still describe the pages, and export falls back to page images (spec §9.5).
  return ok({ doc: raw, encrypted: true, decryptable: false });
}

const hasCryptFilter = (stream: PDFStream) => {
  const filter = get(stream.dict, 'Filter');
  if (filter instanceof PDFName) return filter === PDFName.of('Crypt');
  if (filter instanceof PDFArray) {
    return filter.asArray().some((f) => stream.dict.context.lookup(f) === PDFName.of('Crypt'));
  }
  return false;
};

const PAGES_SAMPLED = 3;
const BYTES_SAMPLED = 512;

/**
 * The capability check (spec §9.6). The fork decrypts silently wrong for some files (mixed crypt
 * filters, `/Crypt` stream filters it does not implement), so a successful load is not enough:
 * the first pages' content streams must decode and read as content-stream text.
 */
function decryptedContentLooksRight(doc: PDFDocument): boolean {
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFStream && hasCryptFilter(object)) return false;
  }
  const pages = doc.getPages().slice(0, PAGES_SAMPLED);
  for (const page of pages) {
    const contents = get(page.node, 'Contents');
    const streams: PDFObject[] =
      contents instanceof PDFArray
        ? contents.asArray().map((c) => doc.context.lookup(c)!)
        : contents
          ? [contents]
          : [];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      let decoded: Uint8Array;
      try {
        decoded = decodePDFRawStream(stream).decode();
      } catch {
        return false;
      }
      const sample = decoded.subarray(0, BYTES_SAMPLED);
      if (sample.length === 0) continue;
      let text = 0;
      for (const b of sample)
        if ((b >= 0x20 && b < 0x7f) || b === 9 || b === 10 || b === 13) text++;
      if (text / sample.length < 0.9) return false;
    }
  }
  return true;
}
