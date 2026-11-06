// Placement by touch (spec §7.2): a tap is one finger, pressed and released within 6 CSS px and
// 400 ms; a second finger joining (a pinch) or a pan places nothing.
import type { PdfInfo } from '@bogey/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayLayer } from '../src/features/overlays/index.ts';
import { chooseTool } from '../src/features/overlays/actions.ts';
import { clearDocumentEdits } from '../src/features/overlays/documentReset.ts';
import { useOverlayUi } from '../src/features/overlays/overlayUi.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { useViewStore } from '../src/state/view.ts';

beforeEach(() => {
  const page = { view: [0, 0, 612, 792], rotate: 0, userUnit: 1 } as const;
  useDocumentStore.getState().update({
    status: 'ready',
    name: 'a.pdf',
    info: {
      formType: 'flat',
      xfa: 'none',
      encrypted: false,
      decryptable: true,
      pageCount: 1,
      pages: [{ index: 0, ...page, view: [...page.view] }],
      fields: [],
      initialValues: {},
      metadata: {},
    } as PdfInfo,
    bytes: new Uint8Array([1]),
  });
  useViewStore.getState().setRenderedZoom(1);
});

afterEach(() => {
  clearDocumentEdits();
  useOverlayUi.getState().reset();
});

const overlays = () => useEditsStore.getState().present.overlays;
const layer = () => screen.getByTestId('overlay-layer');
const finger = (pointerId: number, x: number, y = 100, isPrimary = pointerId === 1) => ({
  pointerId,
  pointerType: 'touch',
  isPrimary,
  button: 0,
  clientX: x,
  clientY: y,
});

describe('tap versus pinch', () => {
  it('a second finger joining cancels the tap, whichever lifts first', () => {
    render(<OverlayLayer />);
    act(() => chooseTool('check'));
    fireEvent.pointerDown(layer(), finger(1, 100));
    fireEvent.pointerDown(layer(), finger(2, 104));
    fireEvent.pointerUp(layer(), finger(2, 104));
    fireEvent.pointerUp(layer(), finger(1, 100));
    expect(overlays()).toHaveLength(0);

    fireEvent.pointerDown(layer(), finger(3, 100, 100, true));
    fireEvent.pointerDown(layer(), finger(4, 104, 100, false));
    fireEvent.pointerUp(layer(), finger(3, 100, 100, true));
    fireEvent.pointerUp(layer(), finger(4, 104, 100, false));
    expect(overlays()).toHaveLength(0);

    // A lone tap afterwards still places.
    fireEvent.pointerDown(layer(), finger(5, 100, 100, true));
    fireEvent.pointerUp(layer(), finger(5, 100, 100, true));
    expect(overlays()).toHaveLength(1);
  });

  it('a lift that never arrived does not block the next tap', () => {
    render(<OverlayLayer />);
    act(() => chooseTool('check'));
    // The first finger's release happened off the page.
    fireEvent.pointerDown(layer(), finger(1, 100));
    fireEvent.pointerDown(layer(), finger(6, 100, 100, true));
    fireEvent.pointerUp(layer(), finger(6, 100, 100, true));
    expect(overlays()).toHaveLength(1);
  });

  it('a cancelled finger (the browser took a pan) places nothing', () => {
    render(<OverlayLayer />);
    act(() => chooseTool('check'));
    fireEvent.pointerDown(layer(), finger(1, 100));
    fireEvent.pointerCancel(layer(), finger(1, 100));
    fireEvent.pointerUp(layer(), finger(1, 100));
    expect(overlays()).toHaveLength(0);
  });

  it('drops the click the browser sends after a finger tap, so it cannot hit the new overlay', () => {
    vi.useFakeTimers();
    try {
      render(<OverlayLayer />);
      const clicked = vi.fn();
      document.body.addEventListener('click', clicked);
      act(() => chooseTool('check'));
      fireEvent.pointerDown(layer(), finger(1, 100));
      fireEvent.pointerUp(layer(), finger(1, 100));
      expect(overlays()).toHaveLength(1);
      expect(fireEvent.click(document.body)).toBe(false);
      expect(clicked).not.toHaveBeenCalled();
      // Only the one click, and only for a short while.
      fireEvent.click(document.body);
      expect(clicked).toHaveBeenCalledTimes(1);

      act(() => chooseTool('check'));
      fireEvent.pointerDown(layer(), finger(1, 300));
      fireEvent.pointerUp(layer(), finger(1, 300));
      vi.advanceTimersByTime(1_000);
      fireEvent.click(document.body);
      expect(clicked).toHaveBeenCalledTimes(2);

      // A mouse click places without touching the click that follows.
      act(() => chooseTool('check'));
      fireEvent.pointerDown(layer(), { ...finger(1, 500), pointerType: 'mouse' });
      fireEvent.pointerUp(layer(), { ...finger(1, 500), pointerType: 'mouse' });
      fireEvent.click(document.body);
      expect(clicked).toHaveBeenCalledTimes(3);
      expect(overlays()).toHaveLength(3);
      document.body.removeEventListener('click', clicked);
    } finally {
      vi.useRealTimers();
    }
  });
});
