// state/edits.ts wired to core's history (spec §7.3, §7.4).
import type { FieldDescriptor, Overlay, PdfInfo } from '@bogey/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';

const field: FieldDescriptor = {
  name: 'name',
  kind: 'text',
  supported: true,
  readOnly: false,
  required: false,
  fontSize: 0,
  textAlign: 'left',
  widgets: [{ page: 0, rect: [0, 0, 10, 10], mkRotation: 0 }],
  tabOrder: 0,
};
const context = { fields: [field], pageCount: 2 };
const overlay: Overlay = {
  id: 'o',
  type: 'text',
  page: 1,
  x: 1,
  y: 2,
  text: 'Hi',
  size: 10,
  bold: false,
};
const empty = { fieldValues: {}, overlays: [] };

afterEach(() => vi.useRealTimers());

describe('edits store', () => {
  it('applies, undoes and redoes validated edits', () => {
    const store = useEditsStore.getState();
    store.load(empty, context);
    store.edit({ type: 'addOverlay', overlay });
    store.edit({ type: 'addOverlay', overlay: { ...overlay, id: 'bad', page: 5 } });
    expect(useEditsStore.getState()).toMatchObject({ canUndo: true, canRedo: false });
    expect(useEditsStore.getState().present.overlays).toEqual([overlay]);
    store.undo();
    expect(useEditsStore.getState()).toMatchObject({
      present: empty,
      canUndo: false,
      canRedo: true,
    });
    store.redo();
    expect(useEditsStore.getState().present.overlays).toEqual([overlay]);
  });

  it('coalesces typing in one field until seal()', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const store = useEditsStore.getState();
    store.load(empty, context);
    store.edit({ type: 'setField', name: 'name', value: 'J' }, { coalesceKey: 'name' });
    vi.setSystemTime(10_300);
    store.edit({ type: 'setField', name: 'name', value: 'Jo' }, { coalesceKey: 'name' });
    store.seal();
    store.edit({ type: 'setField', name: 'name', value: 'Joe' }, { coalesceKey: 'name' });
    store.undo();
    expect(useEditsStore.getState().present.fieldValues).toEqual({ name: 'Jo' });
    store.undo();
    expect(useEditsStore.getState().present).toEqual(empty);
  });

  it("validates against the document store's PdfInfo when no context was given", () => {
    const store = useEditsStore.getState();
    store.load(empty);
    store.edit({ type: 'addOverlay', overlay });
    expect(useEditsStore.getState().present).toBe(empty);
    useDocumentStore.getState().update({ info: { ...context, pages: [] } as unknown as PdfInfo });
    store.edit({ type: 'addOverlay', overlay });
    expect(useEditsStore.getState().present.overlays).toHaveLength(1);
  });
});
