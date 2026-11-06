// The field layer's pure logic (F1–F8, spec §5.4, §6.3, §7.1).
import type { FieldDescriptor, PageGeometry } from '@bogey/core';
import { describe, expect, it } from 'vitest';
import { autoFieldFontSize } from '../src/core-bridge/text.ts';
import {
  asChecked,
  asList,
  asText,
  combCell,
  controlBox,
  controlId,
  currentValue,
  describeValue,
  fieldLabel,
  fontSizePx,
  isFillable,
  isTextTarget,
  kindLabel,
  noticesFor,
  pageWithFields,
  panelRows,
  partialName,
  selectOptions,
  widgetOnValue,
  widgetsOnPage,
} from '../src/features/fields/model.ts';
import { FIELDS, fieldsInfo } from './fieldsInfo.ts';

/** A copy without one optional property (exactOptionalPropertyTypes forbids `undefined`). */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as Omit<T, K>;
}

const byName = (name: string) => FIELDS.find((f) => f.name === name)!;
const page = (rotate: PageGeometry['rotate'] = 0): PageGeometry => ({
  index: 0,
  view: [0, 0, 612, 792],
  rotate,
  userUnit: 1,
});

describe('values (spec §6.3)', () => {
  it('shows the override, else the initial value, looked up as own properties only', () => {
    const initial = { a: 'pdf', b: true };
    expect(currentValue('a', { a: 'mine' }, initial)).toBe('mine');
    expect(currentValue('a', {}, initial)).toBe('pdf');
    expect(currentValue('b', { a: 'x' }, initial)).toBe(true);
    expect(currentValue('__proto__', {}, initial)).toBeUndefined();
    expect(currentValue('toString', {}, initial)).toBeUndefined();
    const hostile = JSON.parse('{"__proto__": "own"}') as Record<string, string>;
    expect(currentValue('__proto__', hostile, initial)).toBe('own');
  });

  it('reads each value shape defensively', () => {
    expect(asText('x')).toBe('x');
    expect(asText(true)).toBe('');
    expect(asText(undefined)).toBe('');
    expect(asChecked(true)).toBe(true);
    expect(asChecked('true')).toBe(false);
    expect(asList(['a'])).toEqual(['a']);
    expect(asList('a')).toEqual(['a']);
    expect(asList('')).toEqual([]);
    expect(asList(false)).toEqual([]);
  });
});

describe('labels (U4)', () => {
  it('uses the alternate name, else the partial name', () => {
    expect(partialName('top[0].Page1[0].f1_01[0]')).toBe('f1_01[0]');
    expect(partialName('plain')).toBe('plain');
    expect(fieldLabel({ name: 'a.b', alternateName: '  Your name ' })).toBe('Your name');
    expect(fieldLabel({ name: 'a.b', alternateName: '  ' })).toBe('b');
    expect(fieldLabel({ name: 'a.b' })).toBe('b');
  });

  it('describes each kind', () => {
    expect(kindLabel(byName('form.notes'))).toBe('Text, several lines');
    expect(kindLabel(byName('form.city'))).toBe('Dropdown, editable');
    expect(kindLabel(byName('form.colour'))).toBe('Dropdown');
    expect(kindLabel(byName('form.sign'))).toBe('Signature');
  });

  it('knows which fields are fillable and which are snippet targets', () => {
    expect(isFillable(byName('form.sign'))).toBe(false);
    expect(isFillable({ ...byName('form.name'), supported: false })).toBe(false);
    expect(isFillable({ ...byName('form.name'), kind: 'button' })).toBe(false);
    expect(isTextTarget(byName('form.name'))).toBe(true);
    expect(isTextTarget(byName('form.fixed'))).toBe(false);
    expect(isTextTarget(byName('form.agree'))).toBe(false);
  });
});

describe('widgets on a page (F6)', () => {
  it('lists the page’s widgets in tab order, then field and widget order', () => {
    const shuffled = [...FIELDS].reverse().map((f, i) => (i === 0 ? { ...f, tabOrder: 0 } : f));
    const names = widgetsOnPage(shuffled, 0).map((p) => `${p.field.name}#${p.widgetIndex}`);
    expect(names.slice(0, 3)).toEqual(['form.name#0', 'form.notes#0', 'form.ssn#0']);
    expect(names).toContain('form.size#0');
    expect(names.indexOf('form.size#1')).toBe(names.indexOf('form.size#0') + 1);
    expect(names).not.toContain('form.city2#0');
    expect(widgetsOnPage(FIELDS, 1).map((p) => p.fieldIndex)).toEqual([12, 13]);
    expect(widgetsOnPage(FIELDS, 7)).toEqual([]);
  });

  it('finds the next and previous page with fillable fields', () => {
    expect(pageWithFields(FIELDS, 0, 1)).toBe(1);
    expect(pageWithFields(FIELDS, 1, 1)).toBeNull();
    expect(pageWithFields(FIELDS, 1, -1)).toBe(0);
    expect(pageWithFields(FIELDS, 0, -1)).toBeNull();
    const sparse = [
      { ...byName('form.name'), widgets: [{ page: 4, rect: [0, 0, 1, 1], mkRotation: 0 }] },
      { ...byName('form.sign'), widgets: [{ page: 2, rect: [0, 0, 1, 1], mkRotation: 0 }] },
    ] as FieldDescriptor[];
    expect(pageWithFields(sparse, 0, 1)).toBe(4);
    expect(pageWithFields(sparse, 9, -1)).toBe(4);
  });

  it('builds ids from indexes, never from the name', () => {
    expect(controlId(3, 1)).toBe('field-3-1');
  });
});

describe('control boxes (F2, spec §5.4)', () => {
  const w = { page: 0, rect: [100, 700, 300, 720], mkRotation: 0 } as const;

  it('places an upright widget at its screen rectangle', () => {
    const box = controlBox(page(), w, 1.5);
    const k = 1.5 * (96 / 72);
    expect(box.rotation).toBe(0);
    expect(box.left).toBeCloseTo(100 * k);
    expect(box.top).toBeCloseTo((792 - 720) * k);
    expect(box.width).toBeCloseTo(200 * k);
    expect(box.height).toBeCloseTo(20 * k);
    expect(box.widthPt).toBeCloseTo(200);
    expect(box.heightPt).toBeCloseTo(20);
    expect(box.k).toBeCloseTo(k);
  });

  it('turns a widget whose content is rotated a quarter turn on its side, centered', () => {
    const turned = { ...w, rect: [100, 500, 120, 700], mkRotation: 90 } as const;
    const box = controlBox(page(), turned, 1);
    const k = 96 / 72;
    expect(box.rotation).toBe(270);
    expect(box.width).toBeCloseTo(200 * k);
    expect(box.height).toBeCloseTo(20 * k);
    // The center stays where the screen rectangle's center is.
    expect(box.left + box.width / 2).toBeCloseTo(110 * k);
    expect(box.top + box.height / 2).toBeCloseTo((792 - 600) * k);
  });

  it('has no net rotation when /MK /R matches the page rotation', () => {
    const box = controlBox(page(90), { ...w, mkRotation: 90 }, 1);
    expect(box.rotation).toBe(0);
    expect(box.widthPt).toBeCloseTo(20);
    expect(box.heightPt).toBeCloseTo(200);
  });
});

describe('font size (spec §7.1)', () => {
  const box = controlBox(page(), { page: 0, rect: [0, 0, 200, 20], mkRotation: 0 }, 2);

  it('scales a fixed /DA size with zoom', () => {
    expect(fontSizePx(byName('form.name'), 'x', box)).toBeCloseTo(12 * box.k);
  });

  it('matches pdf-lib’s auto size for the current value', () => {
    const field = { ...byName('form.name'), fontSize: 0 };
    const expected = autoFieldFontSize(
      'Hello',
      { width: 200, height: 20 },
      { multiline: false, textAlign: 'left' },
    );
    expect(fontSizePx(field, 'Hello', box)).toBeCloseTo(expected * box.k);
    const comb = { ...byName('form.ssn'), fontSize: 0 };
    expect(fontSizePx(comb, '12', box)).toBeGreaterThan(0);
  });

  it('splits a comb field into maxLength cells', () => {
    expect(combCell(byName('form.ssn'), 180)).toBe(20);
    expect(combCell(byName('form.name'), 180)).toBeNull();
    expect(combCell({ ...byName('form.ssn'), maxLength: 0 }, 180)).toBeNull();
    expect(combCell(omit(byName('form.ssn'), 'maxLength'), 180)).toBeNull();
  });
});

describe('choices (F5, spec §7.1)', () => {
  it('offers a blank, the options and any value the options lack', () => {
    const colour = byName('form.colour');
    expect(selectOptions(colour, [''], true).map((o) => o.value)).toEqual(['', 'r', 'g']);
    expect(selectOptions(colour, ['x'], false).map((o) => o.label)).toEqual(['Red', 'Green', 'x']);
    expect(selectOptions(omit(colour, 'options'), [], false)).toEqual([]);
  });

  it('takes a widget’s on-value from the widget, then the field', () => {
    const size = byName('form.size');
    const [s, l] = widgetsOnPage([size], 0);
    expect(widgetOnValue(size, s!)).toBe('S');
    expect(widgetOnValue(size, l!)).toBe('L');
    const bare: FieldDescriptor = {
      ...size,
      widgets: size.widgets.map((w) => omit(w, 'onValue')),
    };
    const [, second] = widgetsOnPage([bare], 0);
    expect(widgetOnValue(bare, second!)).toBe('L');
    const none = omit(bare, 'onValues');
    expect(widgetOnValue(none, second!)).toBe('');
  });
});

describe('the Fields panel rows (F7)', () => {
  it('describes every kind of value', () => {
    expect(describeValue(byName('form.sign'), undefined)).toBe('Not fillable');
    expect(describeValue(byName('form.agree'), true)).toBe('Checked');
    expect(describeValue(byName('form.agree'), false)).toBe('Not checked');
    expect(describeValue(byName('form.days'), [])).toBe('None selected');
    expect(describeValue(byName('form.days'), ['mon', 'tue'])).toBe('Monday, Tuesday');
    expect(describeValue(byName('form.size'), '')).toBe('None selected');
    expect(describeValue(byName('form.size'), 'L')).toBe('L');
    expect(describeValue(byName('form.colour'), 'g')).toBe('Green');
    expect(describeValue(byName('form.name'), '')).toBe('Empty');
    expect(describeValue(byName('form.name'), 'Ann')).toBe('Ann');
    expect(describeValue(byName('form.pin'), '1234')).toBe('••••');
  });

  it('lists fields in tab order and filters by label or full name', () => {
    const info = fieldsInfo();
    const reordered = [FIELDS[1]!, { ...FIELDS[0]!, tabOrder: 5 }];
    expect(panelRows(reordered, {}, {}, '').map((r) => r.field.name)).toEqual([
      'form.notes',
      'form.name',
    ]);
    const rows = panelRows(info.fields, { 'form.name': 'Ann' }, info.initialValues, '');
    expect(rows).toHaveLength(FIELDS.length);
    expect(rows[0]).toMatchObject({
      label: 'Your name',
      kind: 'Text',
      value: 'Ann',
      fieldIndex: 0,
    });
    expect(panelRows(info.fields, {}, info.initialValues, ' YOUR ').map((r) => r.label)).toEqual([
      'Your name',
    ]);
    expect(panelRows(info.fields, {}, info.initialValues, 'form.city').map((r) => r.label)).toEqual(
      ['city', 'city2'],
    );
    expect(panelRows(info.fields, {}, info.initialValues, 'nothing')).toEqual([]);
  });
});

describe('document notices (D4, spec §6.1)', () => {
  it('names the XFA kind and long documents', () => {
    expect(noticesFor({ xfa: 'none', pageCount: 3 }, 300)).toEqual([]);
    expect(noticesFor({ xfa: 'hybrid', pageCount: 3 }, 300)).toEqual(['xfa-hybrid']);
    expect(noticesFor({ xfa: 'dynamic', pageCount: 301 }, 300)).toEqual([
      'xfa-dynamic',
      'many-pages',
    ]);
    expect(noticesFor({ xfa: 'none', pageCount: 300 }, 300)).toEqual([]);
  });
});
