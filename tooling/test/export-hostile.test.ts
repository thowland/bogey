// The exported copy of the hostile fixture contains no active content anywhere in the file, not
// only none reachable from the document root (spec §9.1 step 4, §11.4; found in Sprint 9).
import { readFileSync } from 'node:fs';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  PDFHexString,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { exportPdf, inspectPdf } from '../../packages/core/src/index.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('../../fixtures/vendored/generated/hostile-actions.pdf', import.meta.url)),
);

function text(value: unknown): string {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return String(value);
}

describe('exported hostile fixture', () => {
  it('has no JavaScript, Launch, SubmitForm or javascript: URI in any object', async () => {
    const info = await inspectPdf(bytes);
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    const out = await exportPdf({
      bytes,
      info: info.value,
      state: { fieldValues: {}, overlays: [] },
      signatures: new Map(),
      options: { replaceNonWinAnsi: true, now: 0 },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const doc = await PDFDocument.load(out.value.bytes, { updateMetadata: false });
    const found: string[] = [];
    const visit = (object: unknown) => {
      if (object instanceof PDFDict) {
        for (const [key, value] of object.entries()) {
          if (
            key === PDFName.of('S') &&
            /JavaScript|Launch|SubmitForm|ImportData/.test(text(value))
          )
            found.push(`/S ${text(value)}`);
          if (key === PDFName.of('JS') || key === PDFName.of('AA')) found.push(key.toString());
          if (key === PDFName.of('URI') && /^\s*javascript:/i.test(text(value)))
            found.push('javascript: URI');
          visit(value);
        }
      } else if (object instanceof PDFArray) {
        for (let i = 0; i < object.size(); i++) visit(object.get(i));
      }
    };
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (object instanceof PDFRawStream) {
        visit(object.dict);
        const body = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode());
        if (/app\.alert|\/JavaScript|\/Launch|javascript:/i.test(body)) found.push('stream body');
      } else visit(object);
    }
    expect(found).toEqual([]);
  });
});
