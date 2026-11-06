// Output file name (spec §9.4, D8).

const MAX_STEM = 120;

/**
 * `<stem>-signed.pdf`: strips a final `.pdf`, path separators, control characters and the
 * characters Windows forbids, trims trailing dots and spaces, caps the stem at 120 characters and
 * falls back to `document`.
 */
export function outputFileName(originalName: string): string {
  let stem = originalName.replace(/\.pdf$/i, '');
  // eslint-disable-next-line no-control-regex
  stem = stem.replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/g, '');
  stem = stem.trim();
  stem = [...stem].slice(0, MAX_STEM).join('');
  stem = stem.replace(/[. ]+$/, '');
  return `${stem === '' ? 'document' : stem}-signed.pdf`;
}
