// The decryption spike as a standing test (spec §9.6; results in docs/spikes/S2-decryption.md):
// every encrypted fixture is inspected with its password, filled and flattened where it has a
// text field, overlaid, exported, and read back unencrypted with pdf.js.
import { describe, expect, it } from 'vitest';
import { exportPdf, inspectPdf, type Overlay } from '../../packages/core/src/index.ts';
import {
  UNDECRYPTABLE,
  fixture,
  manifest,
  openWithPdfjs,
  pageText,
  present,
  textItems,
} from './pdfCore.ts';

const encrypted = manifest.filter((e) => e.encrypted && present(e));

async function inspectFixture(path: string, password: string) {
  const r = await inspectPdf(fixture(path), password === '' ? {} : { password });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
}

describe('decryption matrix', () => {
  for (const e of encrypted.filter((x) => UNDECRYPTABLE.has(x.path))) {
    it(`${e.cipher ?? '?'}: ${e.path} is routed to page images`, async () => {
      const password = e.password ?? '';
      const info = await inspectFixture(e.path, password);
      expect(info).toMatchObject({ encrypted: true, decryptable: false });
      const out = await exportPdf({
        bytes: fixture(e.path),
        password,
        info,
        state: { fieldValues: {}, overlays: [] },
        signatures: new Map(),
        options: { replaceNonWinAnsi: false, now: 0 },
      });
      expect(out).toEqual({ ok: false, problems: [{ code: 'export.cannot-decrypt' }] });
    });
  }

  for (const e of encrypted.filter((x) => !UNDECRYPTABLE.has(x.path))) {
    it(`${e.cipher ?? '?'}: ${e.path}`, async () => {
      const bytes = fixture(e.path);
      const password = e.password ?? '';
      const info = await inspectFixture(e.path, password);
      expect(info).toMatchObject({ encrypted: true, decryptable: true });
      const textField = info.fields.find((f) => f.kind === 'text' && !f.readOnly);
      const overlay: Overlay = {
        id: 'o',
        type: 'text',
        page: 0,
        x: info.pages[0]!.view[0] + 40,
        y: info.pages[0]!.view[1] + 40,
        text: 'SPIKEOVERLAY',
        size: 12,
        bold: false,
      };
      const out = await exportPdf({
        bytes,
        password,
        info,
        state: {
          fieldValues: textField ? { [textField.name]: 'SPIKEFIELD' } : {},
          overlays: [overlay],
        },
        signatures: new Map(),
        options: { replaceNonWinAnsi: true, now: 0 },
      });
      if (!out.ok) throw new Error(JSON.stringify(out.problems));
      expect(new TextDecoder('latin1').decode(out.value.bytes)).not.toContain('/Encrypt');
      const exported = await textItems(out.value.bytes);
      expect(exported).toHaveLength(e.pageCount);
      const text = pageText(exported[0]!);
      expect(text).toContain('SPIKEOVERLAY');
      const fieldOnFirstPage = textField !== undefined && textField.widgets[0]!.page === 0;
      expect(text.includes('SPIKEFIELD')).toBe(fieldOnFirstPage);
      // The original's own text survives decryption.
      const original = pageText((await textItems(bytes, password))[0]!).trim();
      expect(text).toContain(original.slice(0, 20));
    });
  }

  it('opens the exports without a password', async () => {
    const e = encrypted.find((x) => x.password && !UNDECRYPTABLE.has(x.path));
    expect(e).toBeDefined();
    const bytes = fixture(e!.path);
    const r = await inspectPdf(bytes, { password: e!.password! });
    if (!r.ok) throw new Error('inspect');
    const out = await exportPdf({
      bytes,
      password: e!.password!,
      info: r.value,
      state: { fieldValues: {}, overlays: [] },
      signatures: new Map(),
      options: { replaceNonWinAnsi: false, now: 0 },
    });
    if (!out.ok) throw new Error('export');
    const pdf = await openWithPdfjs(out.value.bytes);
    expect(pdf.numPages).toBe(e!.pageCount);
    await pdf.close();
  });
});
