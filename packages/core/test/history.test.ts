// Edits and history (spec §7.3, §7.4, §14.3).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CHECK,
  TEXT,
  applyEdit,
  canRedo,
  canUndo,
  createEditState,
  createHistory,
  historyApply,
  isValidFieldValue,
  normalizeOverlay,
  redo,
  sealHistory,
  undo,
  type DocumentEditState,
  type Edit,
  type Overlay,
} from '../src/index.ts';
import { field, info } from './helpers.ts';

const fields = [
  field({ name: 'name', kind: 'text', maxLength: 10 }),
  field({ name: '__proto__', kind: 'text' }),
  field({ name: 'agree', kind: 'checkbox', onValues: ['Yes'] }),
  field({ name: 'choice', kind: 'radio', onValues: ['a', 'b'] }),
  field({ name: 'pick', kind: 'dropdown', options: [{ value: 'A', label: 'Alpha' }] }),
  field({ name: 'combo', kind: 'dropdown', editable: true, options: [] }),
  field({
    name: 'many',
    kind: 'list',
    multiSelect: true,
    options: [
      { value: '1', label: 'One' },
      { value: '2', label: 'Two' },
    ],
  }),
  field({
    name: 'one',
    kind: 'list',
    options: [
      { value: '1', label: 'One' },
      { value: '2', label: 'Two' },
    ],
  }),
  field({ name: 'fixed', kind: 'text', readOnly: true }),
  field({ name: 'press', kind: 'button' }),
];
const ctx = info(fields, 3);

const text = (id: string, extra: Partial<Overlay> = {}): Overlay =>
  ({
    id,
    type: 'text',
    page: 0,
    x: 10,
    y: 20,
    text: 'Hi',
    size: 10,
    bold: false,
    ...extra,
  }) as Overlay;

const arbEdit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({
    type: fc.constant('setField' as const),
    name: fc.constantFrom(
      'name',
      '__proto__',
      'agree',
      'choice',
      'pick',
      'combo',
      'many',
      'one',
      'fixed',
      'press',
      'missing',
      'constructor',
    ),
    value: fc.oneof(
      fc.string({ maxLength: 12 }),
      fc.boolean(),
      fc.array(fc.constantFrom('1', '2', '3'), { maxLength: 3 }),
      fc.constantFrom('a', 'b', 'A'),
    ),
  }),
  fc.record({
    type: fc.constant('addOverlay' as const),
    overlay: fc.oneof(
      fc.record({
        id: fc.constantFrom('t1', 't2', ''),
        type: fc.constantFrom('text' as const, 'date' as const),
        page: fc.integer({ min: -1, max: 4 }),
        x: fc.double(),
        y: fc.double({ min: -1000, max: 1000 }),
        text: fc.string(),
        size: fc.double({ min: -10, max: 100 }),
        bold: fc.boolean(),
      }),
      fc.record({
        id: fc.constantFrom('c1', 'c2'),
        type: fc.constant('check' as const),
        page: fc.integer({ min: 0, max: 3 }),
        x: fc.integer(),
        y: fc.integer(),
        glyph: fc.constantFrom('check' as const, 'x' as const),
        size: fc.integer({ min: 0, max: 40 }),
      }),
      fc.record({
        id: fc.constantFrom('s1'),
        type: fc.constant('signature' as const),
        page: fc.integer({ min: 0, max: 2 }),
        x: fc.integer(),
        y: fc.integer(),
        width: fc.integer({ min: -5, max: 300 }),
        height: fc.integer({ min: -5, max: 100 }),
        signatureId: fc.constantFrom('sig', ''),
      }),
    ) as fc.Arbitrary<Overlay>,
  }),
  fc.record({
    type: fc.constant('updateOverlay' as const),
    id: fc.constantFrom('t1', 'c1', 's1', 'nope'),
    patch: fc.record(
      {
        text: fc.string(),
        size: fc.double({ min: -5, max: 80 }),
        width: fc.integer({ min: -5, max: 200 }),
        glyph: fc.constantFrom('check' as const, 'x' as const),
      },
      { requiredKeys: [] },
    ),
  }),
  fc.record({
    type: fc.constant('moveOverlay' as const),
    id: fc.constantFrom('t1', 'c1', 's1'),
    x: fc.double(),
    y: fc.double(),
  }),
  fc.record({
    type: fc.constant('deleteOverlay' as const),
    id: fc.constantFrom('t1', 'c1', 's1', 'nope'),
  }),
);

/** The state invariants that every reachable state satisfies (spec §14.3 edit validation). */
function assertValid(state: DocumentEditState) {
  for (const name of Object.keys(state.fieldValues)) {
    const f = fields.find((d) => d.name === name);
    expect(f, name).toBeDefined();
    expect(f!.supported && !f!.readOnly).toBe(true);
    expect(isValidFieldValue(f!, state.fieldValues[name])).toBe(true);
  }
  const ids = state.overlays.map((o) => o.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const o of state.overlays) expect(normalizeOverlay(o, ctx.pageCount)).toEqual(o);
}

describe('applyEdit', () => {
  it('never reaches an invalid state, and invalid edits leave the state unchanged', () => {
    fc.assert(
      fc.property(fc.array(arbEdit, { maxLength: 30 }), (edits) => {
        let state = createEditState();
        for (const edit of edits) {
          const next = applyEdit(state, edit, ctx);
          assertValid(next);
          state = next;
        }
      }),
    );
  });

  it('validates field values by kind', () => {
    const s0 = createEditState();
    const set = (name: string, value: unknown) =>
      applyEdit(s0, { type: 'setField', name, value } as Edit, ctx);
    expect(set('name', 'x'.repeat(11))).toBe(s0);
    expect(set('name', 'ok').fieldValues).toEqual({ name: 'ok' });
    expect(set('agree', 'yes')).toBe(s0);
    expect(set('choice', 'c')).toBe(s0);
    expect(set('choice', '').fieldValues).toEqual({ choice: '' });
    expect(set('pick', 'Z')).toBe(s0);
    expect(set('combo', 'anything').fieldValues).toEqual({ combo: 'anything' });
    expect(set('many', ['1', '1'])).toBe(s0);
    expect(set('many', [1])).toBe(s0);
    expect(set('one', ['1', '2'])).toBe(s0);
    expect(set('many', ['2', '1']).fieldValues).toEqual({ many: ['2', '1'] });
    expect(set('fixed', 'x')).toBe(s0);
    expect(set('press', 'x')).toBe(s0);
    expect(set('toString', 'x')).toBe(s0);
    expect(applyEdit(s0, { type: 'nonsense' } as unknown as Edit, ctx)).toBe(s0);
  });

  it("treats a field named '__proto__' as an ordinary field (spec §11.4)", () => {
    const s = applyEdit(
      createEditState(),
      { type: 'setField', name: '__proto__', value: 'v' },
      ctx,
    );
    expect(Object.hasOwn(s.fieldValues, '__proto__')).toBe(true);
    expect(s.fieldValues['__proto__']).toBe('v');
    expect(Object.getPrototypeOf(s.fieldValues)).toBe(Object.prototype);
  });

  it('returns the same state for a repeated value', () => {
    const s1 = applyEdit(createEditState(), { type: 'setField', name: 'many', value: ['1'] }, ctx);
    expect(applyEdit(s1, { type: 'setField', name: 'many', value: ['1'] }, ctx)).toBe(s1);
  });

  it('clamps sizes and edits overlays', () => {
    let s = applyEdit(
      createEditState(),
      { type: 'addOverlay', overlay: text('t1', { size: 99 }) },
      ctx,
    );
    expect(s.overlays[0]).toMatchObject({ size: TEXT.maxSize });
    expect(applyEdit(s, { type: 'addOverlay', overlay: text('t1') }, ctx)).toBe(s);
    s = applyEdit(
      s,
      { type: 'updateOverlay', id: 't1', patch: { size: 1, text: 'Yo', width: 4 } },
      ctx,
    );
    expect(s.overlays[0]).toEqual(text('t1', { size: TEXT.minSize, text: 'Yo' }));
    expect(applyEdit(s, { type: 'updateOverlay', id: 't1', patch: { text: 'Yo' } }, ctx)).toBe(s);
    s = applyEdit(s, { type: 'moveOverlay', id: 't1', x: 1, y: 2 }, ctx);
    expect(s.overlays[0]).toMatchObject({ x: 1, y: 2 });
    expect(applyEdit(s, { type: 'moveOverlay', id: 't1', x: Number.NaN, y: 2 }, ctx)).toBe(s);
    const check = { id: 'c', type: 'check', page: 1, x: 0, y: 0, glyph: 'x', size: 1 } as Overlay;
    s = applyEdit(s, { type: 'addOverlay', overlay: check }, ctx);
    expect(s.overlays[1]).toMatchObject({ size: CHECK.minSize });
    s = applyEdit(s, { type: 'deleteOverlay', id: 't1' }, ctx);
    expect(s.overlays.map((o) => o.id)).toEqual(['c']);
    expect(applyEdit(s, { type: 'deleteOverlay', id: 't1' }, ctx)).toBe(s);
    expect(
      applyEdit(s, { type: 'updateOverlay', id: 'c', patch: null } as unknown as Edit, ctx),
    ).toBe(s);
    expect(normalizeOverlay(null, 1)).toBeNull();
    expect(normalizeOverlay({ ...check, type: 'circle' }, 2)).toBeNull();
  });
});

describe('History', () => {
  const add = (id: string): Edit => ({ type: 'addOverlay', overlay: text(id) });

  it('undo(historyApply(h, e)) restores h.present, and redo(undo(h)) restores h', () => {
    fc.assert(
      fc.property(fc.array(arbEdit, { maxLength: 20 }), arbEdit, (edits, edit) => {
        let h = createHistory(createEditState());
        for (const e of edits) h = historyApply(h, e, ctx, { now: 0 });
        const after = historyApply(h, edit, ctx, { now: 0 });
        // An invalid edit leaves h as it is; otherwise undo returns to h.present.
        expect(after === h ? h.present : undo(after).present).toBe(h.present);
        const back = redo(undo(h));
        expect(back.present).toBe(h.present);
        expect(back.past).toEqual(h.past);
        expect(back.future).toEqual(h.future);
      }),
    );
  });

  it('never exceeds its limit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 30 }), (limit, n) => {
        let h = createHistory(createEditState(), { limit });
        for (let i = 0; i < n; i++) h = historyApply(h, add(`o${i}`), ctx, { now: i * 10_000 });
        expect(h.past.length).toBe(Math.min(limit, n));
      }),
    );
    expect(createHistory(createEditState()).limit).toBe(100);
  });

  it('coalesces edits with the same key within the idle time into one step', () => {
    let h = createHistory(createEditState());
    h = historyApply(h, { type: 'setField', name: 'name', value: 'a' }, ctx, {
      coalesceKey: 'name',
      now: 1000,
    });
    h = historyApply(h, { type: 'setField', name: 'name', value: 'ab' }, ctx, {
      coalesceKey: 'name',
      now: 1500,
    });
    h = historyApply(h, { type: 'setField', name: 'name', value: 'abc' }, ctx, {
      coalesceKey: 'name',
      now: 2400,
    });
    expect(h.past).toHaveLength(1);
    expect(h.present.fieldValues).toEqual({ name: 'abc' });
    // After 1 s of idle, a new step starts.
    h = historyApply(h, { type: 'setField', name: 'name', value: 'abcd' }, ctx, {
      coalesceKey: 'name',
      now: 3500,
    });
    expect(h.past).toHaveLength(2);
    // Sealing (blur) starts a new step even within the idle time.
    h = sealHistory(h);
    expect(sealHistory(h)).toBe(h);
    h = historyApply(h, { type: 'setField', name: 'name', value: 'x' }, ctx, {
      coalesceKey: 'name',
      now: 3600,
    });
    expect(h.past).toHaveLength(3);
    expect(undo(h).present.fieldValues).toEqual({ name: 'abcd' });
  });

  it('leaves h unchanged for invalid edits and at the ends of the stacks', () => {
    const h = createHistory(createEditState());
    expect(historyApply(h, { type: 'deleteOverlay', id: 'none' }, ctx)).toBe(h);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
    const h1 = historyApply(h, add('a'), ctx);
    expect(canUndo(h1)).toBe(true);
    expect(canRedo(undo(h1))).toBe(true);
    expect(historyApply(undo(h1), add('b'), ctx).future).toEqual([]);
  });
});
