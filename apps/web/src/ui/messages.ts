// User-facing text for every problem code (spec §10.4, U6). Raw exception text never reaches the
// user; it goes to the console. Append-only per feature section during concurrent waves
// (implementation plan §1.4): add new codes in core's PROBLEM_CODES and their text here.
import type { Problem, ProblemCode } from '@bogey/core';

type Data = Problem['data'];
const num = (data: Data, key: string, fallback: number) =>
  typeof data?.[key] === 'number' ? data[key] : fallback;

const MESSAGES: Record<ProblemCode, (data: Data) => string> = {
  // ── open ──
  'file.not-pdf': () =>
    'That file is not a PDF. Bogey checks the contents rather than the name, and this one has no PDF header.',
  'file.too-large': (data) =>
    `That file is over ${num(data, 'limitMb', 50)} MB, which is more than Bogey will open in a browser tab.`,
  'file.too-many-pages': (data) =>
    `That document has more than ${num(data, 'limit', 2000)} pages, which is more than Bogey will open.`,
  'file.unreadable': () => 'The browser could not read that file. Try choosing it again.',
  'pdf.password-required': () => 'This PDF is password-protected. Enter its password to open it.',
  'pdf.password-wrong': () => 'That password did not open the document. Check it and try again.',
  'pdf.damaged': () =>
    'This PDF appears to be damaged or uses a structure Bogey cannot read, so it could not be opened.',
  'pdf.timeout': () =>
    'Reading this PDF took too long and was stopped. It may be damaged or unusually complex.',
  // ── export ──
  'export.failed': () =>
    'The signed copy could not be produced. Your work is unchanged; try the download again.',
  'export.verify-failed': () =>
    'The signed copy did not pass Bogey’s final check, so it was not downloaded. Your work is unchanged.',
  'export.timeout': () =>
    'Producing the signed copy took too long and was stopped. Your work is unchanged.',
  'export.signature-missing': () =>
    'A placed signature has been deleted from the library. Remove it from the page or place another.',
  'export.cannot-decrypt': () =>
    'Bogey cannot rewrite this password-protected file directly, so the copy will be made from images of each page.',
  // ── storage ──
  'storage.unavailable': () =>
    'This browser is not letting Bogey save anything, so your work will be lost when the tab closes.',
  'storage.full': () =>
    'This device’s storage for Bogey is full, so this document is open but not saved here.',
  'storage.clear-failed': () =>
    'The browser did not confirm that your saved data was removed. Clear this site’s data in the browser settings to be sure.',
  'storage.restore-missing': () =>
    'The document you were working on is no longer stored in this browser, which can happen when the browser frees up space.',
  // ── signatures ──
  'signature.empty': () => 'There is nothing to save yet. Draw your signature first.',
  'signature.too-large': (data) =>
    `That image is over ${num(data, 'limitMb', 20)} MB. Use a smaller photo or scan of the signature.`,
  'signature.decode-failed': () =>
    'This browser could not read that image. PNG and JPEG work everywhere; HEIC works only in Safari.',
  // ── snippets ──
  'snippets.malformed': () => 'That file is not a Bogey snippets file, so nothing was imported.',
  'snippets.too-large': () =>
    'That snippets file is larger than Bogey accepts, so nothing was imported.',
};

export function messageFor(problem: Problem): string {
  return MESSAGES[problem.code](problem.data);
}

export const messageCodes = (): ProblemCode[] => Object.keys(MESSAGES) as ProblemCode[];

// ── fields (Sprint 5) ──

/** Document notices shown on open (D4, spec §6.1, §6.2). Plain text; no document data. */
export const NOTICES = Object.freeze({
  xfaHybrid:
    'This form also carries an Adobe XFA layer. Bogey fills its standard fields instead; the XFA layer is removed from the downloaded copy.',
  xfaDynamic:
    'This is an Adobe XFA form, and Bogey cannot fill its fields directly. Forms of this kind draw their pages only in Adobe Reader, so what you see here is probably the placeholder page other readers show in its place. You can still type over the page and download a copy.',
  manyPages: (pages: number) =>
    `This document has ${pages.toLocaleString('en-US')} pages. Bogey shows one page at a time, and on an iPad each page may take a few seconds to draw.`,
});

// ── offline (Sprint 9) ──

/** The update prompt (spec §11.5, B7): a new build's service worker is waiting. */
export const UPDATE_PROMPT = Object.freeze({
  text: 'A new version is ready. Reload to update.',
  action: 'Reload',
});
