// Export on in-memory documents (spec §9, §14.4 structural checks). Text positions are checked
// with pdf.js in tooling/test/export-fixtures.test.ts.
import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  PRODUCER,
  exportPageImages,
  exportPdf,
  inspectPdf,
  preflightExport,
  type DocumentEditState,
  type ExportInput,
  type ExportStage,
  type Overlay,
  type PdfInfo,
} from '../src/index.ts';
import { JPEG_1PX, PNG_1PX, field, makeForm, makePages } from './helpers.ts';

async function inspectOk(bytes: Uint8Array, password?: string): Promise<PdfInfo> {
  const r = await inspectPdf(bytes, password === undefined ? {} : { password });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
}

const overlays: Overlay[] = [
  {
    id: 't',
    type: 'text',
    page: 0,
    x: 72,
    y: 100,
    text: 'Line one\nLine two',
    size: 12,
    bold: false,
  },
  { id: 'd', type: 'date', page: 0, x: 72, y: 80, text: '01/02/2026', size: 10, bold: true },
  { id: 'c', type: 'check', page: 0, x: 300, y: 100, glyph: 'check', size: 12 },
  { id: 'x', type: 'check', page: 0, x: 320, y: 100, glyph: 'x', size: 12 },
  {
    id: 's1',
    type: 'signature',
    page: 0,
    x: 400,
    y: 100,
    width: 150,
    height: 50,
    signatureId: 'sig',
  },
  {
    id: 's2',
    type: 'signature',
    page: 0,
    x: 400,
    y: 200,
    width: 75,
    height: 25,
    signatureId: 'sig',
  },
];

const input = (
  bytes: Uint8Array,
  info: PdfInfo,
  state: DocumentEditState,
  extra: Partial<ExportInput> = {},
): ExportInput => ({
  bytes,
  info,
  state,
  signatures: new Map([['sig', { png: PNG_1PX, width: 1, height: 1 }]]),
  options: { replaceNonWinAnsi: false, now: Date.UTC(2026, 10, 6) },
  ...extra,
});

async function exportOk(i: ExportInput, stages?: ExportStage[]) {
  const r = await exportPdf(i, (s) => stages?.push(s));
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
}

const imageXObjects = (doc: PDFDocument) =>
  [...doc.context.enumerateIndirectObjects()].filter(
    ([, o]) =>
      o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
  ).length;

describe('exportPdf', () => {
  it('fills, flattens, draws overlays and saves an unencrypted copy (E1–E9)', async () => {
    const bytes = await makeForm({ encrypt: { user: 'pw', owner: 'owner' }, xfa: true });
    const info = await inspectOk(bytes, 'pw');
    expect(info.xfa).toBe('hybrid');
    const state: DocumentEditState = {
      fieldValues: {
        name: 'Jane Doe',
        zip: '12345',
        notes: 'a\nb',
        agree: true,
        choice: 'b',
        pick: 'Beta',
        many: ['One', 'Three'],
        fixed: 'hacked',
      },
      overlays,
    };
    const stages: ExportStage[] = [];
    const out = await exportOk(input(bytes, info, state, { password: 'pw' }), stages);
    expect(stages).toEqual(['loading', 'fields', 'drawing', 'saving', 'checking']);
    expect(out.rasterized).toBe(false);
    const doc = await PDFDocument.load(out.bytes, { updateMetadata: false });
    expect(doc.isEncrypted).toBe(false);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getProducer()).toBe(PRODUCER);
    // The fork's own encrypt() (used to build this fixture) blanks /Info; metadata is checked below.
    expect(doc.getModificationDate()?.getTime()).toBe(Date.UTC(2026, 10, 6));
    // G6: the signature is embedded once for both placements.
    expect(imageXObjects(doc)).toBe(1);
    expect(new TextDecoder('latin1').decode(out.bytes)).not.toContain('/Encrypt');
  });

  it('exports flat and rotated pages and a dynamic XFA placeholder', async () => {
    const pages = await makePages([0, 90, 180, 270]);
    const info = await inspectOk(pages);
    const rotated = overlays.map((o, i) => ({ ...o, page: i % 4 }));
    const out = await exportOk(input(pages, info, { fieldValues: {}, overlays: rotated }));
    const flat = await PDFDocument.load(out.bytes, { updateMetadata: false });
    expect(flat.getPageCount()).toBe(4);
    expect(flat.getTitle()).toBe('Pages');
    const dynamic = await makeForm({ xfa: true, needsRendering: true });
    const dInfo = await inspectOk(dynamic);
    const dOut = await exportOk(input(dynamic, dInfo, { fieldValues: {}, overlays: [] }));
    const doc = await PDFDocument.load(dOut.bytes, { preserveXFA: true });
    expect(doc.catalog.get(PDFName.of('NeedsRendering'))).toBeUndefined();
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  it('reports missing signatures, bad pages, passwords and undecryptable files', async () => {
    const bytes = await makeForm();
    const info = await inspectOk(bytes);
    const missing = await exportPdf(
      input(bytes, info, {
        fieldValues: {},
        overlays: [{ ...(overlays[4] as Overlay & { type: 'signature' }), signatureId: 'gone' }],
      }),
    );
    expect(missing).toEqual({
      ok: false,
      problems: [{ code: 'export.signature-missing', data: { pages: '1' } }],
    });
    const badPage = await exportPdf(
      input(bytes, info, { fieldValues: {}, overlays: [{ ...overlays[0]!, page: 5 }] }),
    );
    expect(badPage).toEqual({
      ok: false,
      problems: [{ code: 'export.failed', data: { reason: 'overlay-page' } }],
    });
    const enc = await makeForm({ encrypt: { user: 'pw', owner: 'o' } });
    const encInfo = await inspectOk(enc, 'pw');
    const wrong = await exportPdf(
      input(enc, encInfo, { fieldValues: {}, overlays: [] }, { password: 'no' }),
    );
    expect(wrong).toEqual({ ok: false, problems: [{ code: 'pdf.password-wrong' }] });
    const cannot = await exportPdf(
      input(bytes, { ...info, decryptable: false }, { fieldValues: {}, overlays: [] }),
    );
    expect(cannot).toEqual({ ok: false, problems: [{ code: 'export.cannot-decrypt' }] });
    const junk = await exportPdf(
      input(new Uint8Array([1, 2, 3]), info, { fieldValues: {}, overlays: [] }),
    );
    expect(junk).toEqual({ ok: false, problems: [{ code: 'export.failed' }] });
  });

  it('refuses characters outside WinAnsi unless replacement was confirmed (E4)', async () => {
    const bytes = await makeForm();
    const info = await inspectOk(bytes);
    const state: DocumentEditState = {
      fieldValues: { name: 'Ωmega' },
      overlays: [{ ...(overlays[0] as Overlay & { type: 'text' }), text: 'Snowman ☃' }],
    };
    expect(await exportPdf(input(bytes, info, state))).toEqual({
      ok: false,
      problems: [{ code: 'export.failed', data: { reason: 'non-winansi' } }],
    });
    const out = await exportOk(
      input(bytes, info, state, { options: { replaceNonWinAnsi: true, now: 0 } }),
    );
    expect(out.bytes.length).toBeGreaterThan(0);
  });
});

describe('preflightExport', () => {
  it('names overlays and overridden fields with offending characters', () => {
    const fields = [
      field({ name: 'a', kind: 'text', widgets: [{ page: 2, rect: [0, 0, 1, 1], mkRotation: 0 }] }),
      field({ name: 'b', kind: 'list', options: [{ value: 'x', label: 'Ω' }] }),
      field({ name: 'c', kind: 'dropdown', options: [{ value: 'y', label: '✓' }] }),
      field({ name: 'ro', kind: 'text', readOnly: true }),
      field({ name: 'chk', kind: 'checkbox' }),
      field({ name: 'quiet', kind: 'text', widgets: [] }),
    ];
    const state: DocumentEditState = {
      fieldValues: { a: 'π and π', b: ['x'], c: 'y', ro: 'Ω', chk: true, quiet: 'Ω' },
      overlays: [
        { id: 't', type: 'text', page: 1, x: 0, y: 0, text: '日本', size: 10, bold: false },
        { id: 'ok', type: 'date', page: 0, x: 0, y: 0, text: '01/01/2026', size: 10, bold: false },
        overlays[2]!,
      ],
    };
    expect(preflightExport(state, fields)).toEqual([
      { subject: { kind: 'overlay', id: 't', page: 1 }, characters: ['日', '本'] },
      { subject: { kind: 'field', name: 'a', page: 2 }, characters: ['π'] },
      { subject: { kind: 'field', name: 'b', page: 0 }, characters: ['Ω'] },
      { subject: { kind: 'field', name: 'c', page: 0 }, characters: ['✓'] },
      { subject: { kind: 'field', name: 'quiet', page: 0 }, characters: ['Ω'] },
    ]);
  });
});

describe('exportPageImages', () => {
  it('builds image pages with the original geometry and draws overlays (spec §9.5)', async () => {
    const info = await inspectOk(
      await makePages([90, 0], { media: [700, 900], crop: [50, 80, 612, 792] }),
    );
    const stages: ExportStage[] = [];
    const r = await exportPageImages(
      {
        pages: [{ jpeg: JPEG_1PX }, { jpeg: JPEG_1PX }],
        info: {
          ...info,
          pages: info.pages.map((p, i) => (i === 1 ? { ...p, userUnit: 2 } : p)),
          metadata: { title: 'T', author: 'A' },
        },
        state: { fieldValues: {}, overlays: [overlays[0]!, { ...overlays[4]!, page: 1 }] },
        signatures: new Map([['sig', { png: PNG_1PX, width: 1, height: 1 }]]),
        options: { replaceNonWinAnsi: true, now: 0 },
      },
      (s) => stages.push(s),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.value.rasterized).toBe(true);
    expect(stages).toEqual(['loading', 'drawing', 'saving', 'checking']);
    const again = await inspectOk(r.value.bytes);
    expect(again.pages[0]).toEqual({ ...info.pages[0], index: 0 });
    expect(again.pages[1]!.userUnit).toBe(2);
    expect(again.metadata).toEqual({ title: 'T', author: 'A' });
  });

  it('requires one image per page', async () => {
    const info = await inspectOk(await makePages([0]));
    const base = {
      info,
      state: { fieldValues: {}, overlays: [] },
      signatures: new Map(),
      options: { replaceNonWinAnsi: false, now: 0 },
    };
    expect(await exportPageImages({ ...base, pages: [] })).toEqual({
      ok: false,
      problems: [{ code: 'export.failed', data: { reason: 'page-images' } }],
    });
    expect(await exportPageImages({ ...base, pages: [{ jpeg: new Uint8Array([1]) }] })).toEqual({
      ok: false,
      problems: [{ code: 'export.failed' }],
    });
    const bad = {
      ...base,
      state: { fieldValues: {}, overlays: [{ ...overlays[0]!, text: 'Ω' } as Overlay] },
    };
    expect((await exportPageImages({ ...bad, pages: [{ jpeg: JPEG_1PX }] })).ok).toBe(false);
  });
});
