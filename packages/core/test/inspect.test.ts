// Inspection on in-memory documents (spec §6.2, §6.3), so it runs in Node and every browser.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { classify, hasPdfHeader, inspectPdf, type PdfInfo } from '../src/index.ts';
import { makeForm, makePages } from './helpers.ts';

async function inspectOk(bytes: Uint8Array, password?: string): Promise<PdfInfo> {
  const r = await inspectPdf(bytes, password === undefined ? {} : { password });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
}

describe('inspectPdf', () => {
  it('describes an AcroForm with every field kind (F1)', async () => {
    const info = await inspectOk(await makeForm());
    expect(info).toMatchObject({
      formType: 'acroform',
      xfa: 'none',
      encrypted: false,
      decryptable: true,
      pageCount: 1,
    });
    expect(info.metadata).toEqual({ title: 'Test form', author: 'Bogey tests' });
    const byName = Object.fromEntries(info.fields.map((f) => [f.name, f]));
    expect(Object.keys(byName).sort()).toEqual([
      'agree',
      'choice',
      'fixed',
      'many',
      'name',
      'notes',
      'pick',
      'press',
      'zip',
    ]);
    expect(byName.zip).toMatchObject({ kind: 'text', comb: true, maxLength: 5, multiline: false });
    expect(byName.notes).toMatchObject({ kind: 'text', multiline: true });
    expect(byName.agree).toMatchObject({ kind: 'checkbox', onValues: ['Yes'] });
    expect(byName.choice).toMatchObject({ kind: 'radio', onValues: ['a', 'b'] });
    expect(byName.choice!.widgets.map((w) => w.onValue)).toEqual(['a', 'b']);
    expect(byName.pick).toMatchObject({
      kind: 'dropdown',
      editable: false,
      options: [
        { value: 'Alpha', label: 'Alpha' },
        { value: 'Beta', label: 'Beta' },
      ],
    });
    expect(byName.many).toMatchObject({ kind: 'list', multiSelect: true });
    expect(byName.fixed).toMatchObject({ readOnly: true });
    expect(byName.press).toMatchObject({ kind: 'button', supported: false });
    expect(byName.name!.widgets).toEqual([
      { page: 0, rect: [99.5, 699.5, 300.5, 720.5], mkRotation: 0 },
    ]);
    expect(info.initialValues).toEqual({
      name: '',
      zip: '',
      notes: '',
      agree: false,
      choice: '',
      pick: '',
      many: [],
      fixed: 'Locked',
    });
    // Tab order follows /Annots order on the page (F6).
    expect(info.fields.map((f) => f.tabOrder)).toEqual(info.fields.map((_, i) => i));
    expect(info.fields[0]!.name).toBe('name');
  });

  it('classifies hybrid and dynamic XFA (D4)', async () => {
    const hybrid = await inspectOk(await makeForm({ xfa: true }));
    expect(hybrid).toMatchObject({ formType: 'acroform', xfa: 'hybrid' });
    expect(hybrid.fields.length).toBe(9);
    const dynamic = await inspectOk(await makeForm({ xfa: true, needsRendering: true }));
    expect(dynamic).toMatchObject({ formType: 'xfa', xfa: 'dynamic', fields: [] });
    expect(classify(true, false, 0)).toEqual({ formType: 'xfa', xfa: 'dynamic' });
    expect(classify(false, false, 0)).toEqual({ formType: 'flat', xfa: 'none' });
  });

  it('reads page geometry, inherited rotation and the crop box', async () => {
    const info = await inspectOk(
      await makePages([0, 90, 180, 270], { media: [700, 900], crop: [50, 80, 612, 792] }),
    );
    expect(info.formType).toBe('flat');
    expect(info.pages.map((p) => p.rotate)).toEqual([0, 90, 180, 270]);
    expect(info.pages[1]).toEqual({ index: 1, view: [50, 80, 662, 872], rotate: 90, userUnit: 1 });
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    doc.getPages()[0]!.node.delete(PDFName.of('Rotate'));
    doc.catalog.lookup(PDFName.of('Pages'), PDFDict).set(PDFName.of('Rotate'), doc.context.obj(90));
    doc.getPages()[0]!.node.set(PDFName.of('UserUnit'), doc.context.obj(2));
    const inherited = await inspectOk(await doc.save());
    expect(inherited.pages[0]).toMatchObject({ rotate: 90, userUnit: 2 });
  });

  it('handles passwords (D3)', async () => {
    const bytes = await makeForm({ encrypt: { user: 'secret', owner: 'owner' } });
    expect(await inspectPdf(bytes)).toEqual({
      ok: false,
      problems: [{ code: 'pdf.password-required' }],
    });
    expect(await inspectPdf(bytes, { password: 'nope' })).toEqual({
      ok: false,
      problems: [{ code: 'pdf.password-wrong' }],
    });
    expect(await inspectPdf(bytes, { password: 'pässwört' })).toEqual({
      ok: false,
      problems: [{ code: 'pdf.password-wrong' }],
    });
    const info = await inspectOk(bytes, 'secret');
    expect(info).toMatchObject({ encrypted: true, decryptable: true, formType: 'acroform' });
    const ownerOnly = await inspectOk(await makeForm({ encrypt: { owner: 'owner' } }));
    expect(ownerOnly).toMatchObject({ encrypted: true, decryptable: true });
  });

  it('refuses non-PDF and damaged input', async () => {
    expect(hasPdfHeader(new TextEncoder().encode('junk\n%PDF-1.7'))).toBe(true);
    expect(await inspectPdf(new TextEncoder().encode('hello'))).toEqual({
      ok: false,
      problems: [{ code: 'file.not-pdf' }],
    });
    expect(await inspectPdf(new TextEncoder().encode('%PDF-1.7\n garbage'))).toEqual({
      ok: false,
      problems: [{ code: 'pdf.damaged' }],
    });
  });

  it('assigns widgets by /P or /Annots, drops unplaced ones, and honours /Tabs /R', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const [p0, p1] = [doc.addPage(), doc.addPage()];
    const form = doc.getForm();
    // Added in reverse visual order; /Tabs /R sorts them top to bottom.
    form.createTextField('low').addToPage(p1, { x: 10, y: 100, width: 50, height: 20, font });
    form.createTextField('high').addToPage(p1, { x: 10, y: 500, width: 50, height: 20, font });
    form.createTextField('first').addToPage(p0, { x: 10, y: 100, width: 50, height: 20, font });
    p1.node.set(PDFName.of('Tabs'), PDFName.of('R'));
    // A field whose widget has no /P but is in /Annots, and one whose widget is on no page.
    const noP = form.createTextField('noP');
    noP.addToPage(p0, { x: 100, y: 100, width: 50, height: 20, font });
    noP.acroField.getWidgets()[0]!.dict.delete(PDFName.of('P'));
    const lost = form.createTextField('lost');
    lost.addToPage(p0, { x: 200, y: 100, width: 50, height: 20, font });
    const lostWidget = lost.acroField.getWidgets()[0]!;
    lostWidget.dict.delete(PDFName.of('P'));
    const annots = p0.node.lookup(PDFName.of('Annots'), PDFArray);
    annots.remove(annots.size() - 1);
    // A checkbox with two widgets and distinct on-states behaves as a radio group.
    const pair = form.createCheckBox('pair');
    pair.addToPage(p0, { x: 10, y: 300, width: 10, height: 10 });
    pair.addToPage(p0, { x: 30, y: 300, width: 10, height: 10 });
    const [w1, w2] = pair.acroField.getWidgets();
    const renameOn = (w: typeof w1, name: string) => {
      const n = w!.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFDict);
      n.set(PDFName.of(name), n.get(PDFName.of('Yes'))!);
      n.delete(PDFName.of('Yes'));
    };
    renameOn(w1, 'Left');
    renameOn(w2, 'Right');
    pair.acroField.dict.set(PDFName.of('V'), PDFName.of('Right'));
    // Alternate name and a field named __proto__.
    form.getTextField('first').acroField.dict.set(PDFName.of('TU'), PDFString.of('First name'));
    form
      .createTextField('__proto__')
      .addToPage(p0, { x: 300, y: 300, width: 50, height: 20, font });
    const info = await inspectOk(await doc.save());
    expect(info.fields.map((f) => f.name)).toEqual([
      'first',
      'noP',
      'pair',
      '__proto__',
      'high',
      'low',
    ]);
    expect(info.fields[0]!.alternateName).toBe('First name');
    const pairField = info.fields.find((f) => f.name === 'pair')!;
    expect(pairField).toMatchObject({ kind: 'radio', onValues: ['Left', 'Right'] });
    expect(info.initialValues.pair).toBe('Right');
    expect(Object.hasOwn(info.initialValues, '__proto__')).toBe(true);
    expect(info.fields.find((f) => f.name === 'high')!.widgets[0]!.page).toBe(1);
  });
});
