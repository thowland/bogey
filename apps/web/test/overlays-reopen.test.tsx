// Opening a second document shows nothing of the first (spec §7.4): no field values, overlays,
// selection, last point or snippet target carry over.
import type { PdfInfo } from '@bogey/core';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { stubPdfBridge, type PdfBridge } from '../src/core-bridge/pdf.ts';
import { FieldLayer } from '../src/features/fields/index.ts';
import { openDocument } from '../src/features/open/openDocument.ts';
import { OverlayLayer } from '../src/features/overlays/index.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { useViewStore } from '../src/state/view.ts';
import { fakeLoader, pdfFile } from './fakePdfjs.ts';
import { fieldsInfo } from './fieldsInfo.ts';

const bridgeFor = (info: PdfInfo): PdfBridge => ({
  ...stubPdfBridge,
  inspect: () => Promise.resolve({ ok: true, value: info }),
});

const services = (info: PdfInfo) => ({
  bridge: bridgeFor(info),
  loader: fakeLoader({ pageCount: 2 }),
  askPassword: () => Promise.resolve(null),
});

describe('reopening', () => {
  it('opening document B shows none of document A’s values or overlays', async () => {
    const info = fieldsInfo();
    await act(() => openDocument(pdfFile('a.pdf'), services(info)));
    act(() => {
      useViewStore.getState().setRenderedZoom(1);
      useEditsStore.getState().edit({ type: 'setField', name: 'form.name', value: 'Ada' });
      useEditsStore.getState().edit({
        type: 'addOverlay',
        overlay: { id: 'o', type: 'check', page: 0, x: 72, y: 72, glyph: 'check', size: 12 },
      });
      useViewStore.getState().select('o');
      useViewStore.getState().setLastPoint({ page: 0, point: { x: 1, y: 2 } });
      useViewStore.getState().setTargetField('form.name');
    });
    render(
      <div>
        <FieldLayer />
        <OverlayLayer />
      </div>,
    );
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('Ada');
    expect(screen.getByRole('button', { name: 'Check mark overlay, page 1' })).toBeInTheDocument();

    await act(() => openDocument(pdfFile('b.pdf'), services(fieldsInfo())));
    act(() => useViewStore.getState().setRenderedZoom(1));
    expect(useEditsStore.getState().present).toEqual({ fieldValues: {}, overlays: [] });
    expect(useEditsStore.getState().canUndo).toBe(false);
    expect(useViewStore.getState()).toMatchObject({
      selectedOverlayId: null,
      lastPoint: null,
      targetField: null,
    });
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Check mark overlay/ })).toBeNull();
  });
});
