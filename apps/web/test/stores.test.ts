import { EMPTY_EDIT_STATE, type DocumentEditState } from '@bogey/core';
import { describe, expect, it } from 'vitest';
import { pdfBridge, setPdfBridge, stubPdfBridge } from '../src/core-bridge/pdf.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { useSettingsStore } from '../src/state/settings.ts';
import { useSignaturesStore } from '../src/state/signatures.ts';
import { useSnippetsStore } from '../src/state/snippets.ts';
import { useViewStore } from '../src/state/view.ts';

describe('view store', () => {
  it('clamps pages, clears selection on tool change, and chooses signatures', () => {
    const view = useViewStore.getState();
    view.setPage(-3);
    expect(useViewStore.getState().page).toBe(0);
    view.select('o1');
    view.setTool('text');
    expect(useViewStore.getState()).toMatchObject({ tool: 'text', selectedOverlayId: null });
    view.chooseSignature('s1');
    expect(useViewStore.getState()).toMatchObject({ tool: 'signature', selectedSignatureId: 's1' });
    view.chooseSignature(null);
    expect(useViewStore.getState().tool).toBe('select');
    view.setZoom(1.5);
    view.setLastPoint({ page: 2, point: { x: 10, y: 20 } });
    view.setTargetField('name');
    view.setPanel(false);
    expect(useViewStore.getState()).toMatchObject({
      zoom: 1.5,
      lastPoint: { page: 2 },
      targetField: 'name',
      panelOpen: false,
      panelTab: 'fields',
    });
  });
});

describe('document, settings, signatures and snippets stores', () => {
  it('update and reset', () => {
    useDocumentStore.getState().update({ status: 'opening', name: 'w9.pdf' });
    expect(useDocumentStore.getState()).toMatchObject({ status: 'opening', name: 'w9.pdf' });
    useSettingsStore.getState().update({ dateFormat: 'YYYY-MM-DD' });
    expect(useSettingsStore.getState().dateFormat).toBe('YYYY-MM-DD');
    useSignaturesStore
      .getState()
      .setAll(
        [{ id: 's', name: 'Me', kind: 'signature', width: 1, height: 1, createdAt: 0 }],
        new Map(),
      );
    expect(useSignaturesStore.getState()).toMatchObject({ loaded: true });
    useSnippetsStore.getState().setAll([
      { id: 'b', label: 'B', value: '', order: 2 },
      { id: 'a', label: 'A', value: '', order: 1 },
    ]);
    expect(useSnippetsStore.getState().items.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('edits store (contract until Sprint 2)', () => {
  it('loads state and clears history', () => {
    const state: DocumentEditState = { fieldValues: { a: 'x' }, overlays: [] };
    const edits = useEditsStore.getState();
    edits.load(state);
    edits.edit({ type: 'setField', name: 'a', value: 'y' });
    edits.undo();
    edits.redo();
    expect(useEditsStore.getState()).toMatchObject({ present: state, canUndo: false });
    edits.reset();
    expect(useEditsStore.getState().present).toBe(EMPTY_EDIT_STATE);
  });
});

describe('pdf bridge stub (contract until Sprint 2)', () => {
  it('treats documents as flat and refuses export', async () => {
    const info = await pdfBridge().inspect(new Uint8Array(), 'pw');
    expect(info).toMatchObject({ ok: true, value: { formType: 'flat', encrypted: true } });
    const plain = await stubPdfBridge.inspect(new Uint8Array());
    expect(plain).toMatchObject({ ok: true, value: { encrypted: false } });
    const exported = await pdfBridge().exportPdf({} as never);
    expect(exported).toEqual({ ok: false, problems: [{ code: 'export.failed' }] });
  });

  it('can be replaced', () => {
    const bridge = { ...stubPdfBridge };
    setPdfBridge(bridge);
    expect(pdfBridge()).toBe(bridge);
  });
});
