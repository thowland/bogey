// Inspection against every manifest entry (spec §6, implementation plan Sprint 2 tests).
import { describe, expect, it } from 'vitest';
import { inspectPdf } from '../../packages/core/src/index.ts';
import { UNDECRYPTABLE, fixture, manifest, present } from './pdfCore.ts';

const available = manifest.filter(present);
const skipped = manifest.length - available.length;

describe('inspectPdf on the fixture manifest', () => {
  it(`covers every available fixture (${skipped} fetched fixtures absent)`, () => {
    expect(available.filter((e) => e.path.startsWith('fixtures/vendored/')).length).toBeGreaterThan(30);
  });

  for (const e of available) {
    it(e.path, async () => {
      const r = await inspectPdf(fixture(e.path), e.password ? { password: e.password } : {});
      if (!r.ok) throw new Error(JSON.stringify(r.problems));
      const info = r.value;
      expect(info.encrypted).toBe(e.encrypted);
      expect(info.pageCount).toBe(e.pageCount);
      expect(info.pages).toHaveLength(e.pageCount);
      expect([...new Set(info.pages.map((p) => p.rotate))].sort()).toEqual([...new Set(e.rotation)].sort());
      if (e.cropOrigin) expect(info.pages.some((p) => p.view[0] !== 0 || p.view[1] !== 0)).toBe(true);
      if (UNDECRYPTABLE.has(e.path)) {
        expect(info).toMatchObject({ decryptable: false, formType: 'flat', fields: [] });
        return;
      }
      expect(info.decryptable).toBe(true);
      // The manifest records the document's class; a hybrid form is filled as an AcroForm (§6.2).
      expect(info.xfa).toBe(e.xfa);
      expect(info.formType).toBe(e.xfa === 'hybrid' ? 'acroform' : e.formType);
      if (info.formType === 'acroform') expect(info.fields.length).toBeGreaterThan(0);
      else expect(info.fields).toEqual([]);
      for (const kind of e.fieldKinds ?? []) {
        expect(info.fields.map((f) => f.kind), kind).toContain(kind);
      }
      for (const f of info.fields) {
        expect(f.widgets.length).toBeGreaterThan(0);
        for (const w of f.widgets) expect(w.page).toBeLessThan(info.pageCount);
      }
      expect(info.fields.map((f) => f.tabOrder)).toEqual(info.fields.map((_, i) => i));
    });
  }

  it('enumerates the generated AcroForm exactly', async () => {
    const r = await inspectPdf(fixture('fixtures/vendored/generated/acroform-all.pdf'));
    if (!r.ok) throw new Error('inspect');
    expect(r.value.fields.map((f) => `${f.name}:${f.kind}`)).toEqual([
      'text1:text',
      'multiline1:text',
      'comb1:text',
      'check1:checkbox',
      'radio1:radio',
      'dropdown1:dropdown',
      'list1:list',
      'readonly1:text',
      'button1:button',
    ]);
    expect(r.value.initialValues).toMatchObject({ readonly1: 'Fixed value', check1: false });
  });

  const IRS: [string, number][] = [
    ['fixtures/fetched/irs/fw9.pdf', 23],
    ['fixtures/fetched/irs/fw4.pdf', 48],
    ['fixtures/fetched/irs/f1040.pdf', 199],
  ];
  for (const [path, count] of IRS.filter(([p]) => present({ path: p } as never))) {
    it(`finds the IRS form's fields: ${path}`, async () => {
      const r = await inspectPdf(fixture(path));
      if (!r.ok) throw new Error('inspect');
      expect(r.value.fields).toHaveLength(count);
      const kinds = new Set(r.value.fields.map((f) => f.kind));
      expect(kinds.has('text') && kinds.has('checkbox')).toBe(true);
      expect(r.value.fields.some((f) => f.comb === true || f.maxLength !== undefined)).toBe(true);
    });
  }
});
