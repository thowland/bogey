// Pinch, gesture-event and Ctrl+wheel zoom on the page view (V4, spec §10.4), and the canvas cap
// for hidden neighbors (V6), against a fake pdf.js document.
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { PdfInfo } from '@bogey/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, TIMING } from '../src/config.ts';
import { hasGestureEvents } from '../src/features/viewer/gestures/index.ts';
import { PageView } from '../src/features/viewer/PageView.tsx';
import { useDocumentStore } from '../src/state/document.ts';
import { useViewStore } from '../src/state/view.ts';
import { fakeDocument } from './fakePdfjs.ts';

/** The transform during a horizontal gesture, as the CSSOM writes it back. */
const shift = (x: number, scale: number) => `translate(${x}px) scale(${scale})`;

async function showPage(pageCount = 1, zoom: number | 'fit-width' = 1) {
  const display = fakeDocument(pageCount);
  useDocumentStore.getState().update({
    status: 'ready',
    display,
    info: { formType: 'flat' } as PdfInfo,
  });
  useViewStore.getState().setZoom(zoom);
  render(<PageView />);
  await waitFor(() => expect(useViewStore.getState().renderedZoom).not.toBeNull());
  const area = document.querySelector<HTMLElement>('[role="region"]')!;
  const sheet = () => area.querySelector<HTMLElement>('[data-page]:not([hidden])')!;
  return { display, area, sheet };
}

const touch = (pointerId: number, clientX: number, clientY: number) => ({
  pointerId,
  pointerType: 'touch',
  clientX,
  clientY,
});

/** A WebKit gesture event; jsdom has none, so its fields are set on a plain event. */
function gesture(target: EventTarget, type: string, scale: number, clientX = 100, clientY = 100) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX, clientY });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('two-finger pinch (browsers without gesture events)', () => {
  beforeEach(() => {
    expect(hasGestureEvents()).toBe(false);
  });

  it('scales the page with a transform and commits the zoom when a finger lifts', async () => {
    const { sheet } = await showPage();
    fireEvent.pointerDown(sheet(), touch(1, 100, 100));
    expect(sheet().style.transform).toBe('');
    fireEvent.pointerDown(sheet(), touch(2, 200, 100));
    expect(sheet().style.transformOrigin).toBe('150px 100px');
    fireEvent.pointerMove(sheet(), touch(2, 300, 100));
    // Twice the distance; the centre moved 50 px right.
    expect(sheet().style.transform).toBe(shift(50, 2));
    expect(useViewStore.getState().zoom).toBe(1);
    fireEvent.pointerUp(sheet(), touch(1, 100, 100));
    expect(useViewStore.getState().zoom).toBe(2);
    expect(sheet().style.transform).toBe('');
    expect(sheet().style.width).toBe(`${816 * 2}px`);
    await waitFor(() => expect(useViewStore.getState().renderedZoom).toBe(2));
  });

  it('commits at most 300% and at least 50%', async () => {
    const { sheet } = await showPage();
    fireEvent.pointerDown(sheet(), touch(1, 100, 100));
    fireEvent.pointerDown(sheet(), touch(2, 110, 100));
    fireEvent.pointerMove(sheet(), touch(2, 900, 100));
    fireEvent.pointerCancel(sheet(), touch(2, 900, 100));
    expect(useViewStore.getState().zoom).toBe(3);
    fireEvent.pointerUp(sheet(), touch(1, 100, 100));

    fireEvent.pointerDown(sheet(), touch(3, 100, 100));
    fireEvent.pointerDown(sheet(), touch(4, 500, 100));
    fireEvent.pointerMove(sheet(), touch(4, 101, 100));
    fireEvent.pointerUp(sheet(), touch(3, 100, 100));
    expect(useViewStore.getState().zoom).toBe(0.5);
  });

  it('ignores mice, a third finger and moves of fingers it is not tracking', async () => {
    const { sheet } = await showPage();
    fireEvent.pointerDown(sheet(), { ...touch(1, 0, 0), pointerType: 'mouse' });
    fireEvent.pointerDown(sheet(), { ...touch(2, 100, 0), pointerType: 'mouse' });
    fireEvent.pointerMove(sheet(), { ...touch(2, 300, 0), pointerType: 'mouse' });
    fireEvent.pointerUp(sheet(), { ...touch(2, 300, 0), pointerType: 'mouse' });
    expect(sheet().style.transform).toBe('');
    expect(useViewStore.getState().zoom).toBe(1);

    fireEvent.pointerDown(sheet(), touch(1, 100, 100));
    fireEvent.pointerMove(sheet(), touch(1, 120, 100));
    fireEvent.pointerDown(sheet(), touch(2, 200, 100));
    fireEvent.pointerDown(sheet(), touch(3, 900, 900));
    fireEvent.pointerMove(sheet(), touch(3, 0, 0));
    fireEvent.pointerUp(sheet(), touch(3, 0, 0));
    expect(sheet().style.transform).toBe(shift(0, 1));
    // Lifting with the fingers where they started changes nothing.
    fireEvent.pointerUp(sheet(), touch(2, 200, 100));
    expect(sheet().style.transform).toBe('');
    expect(useViewStore.getState().zoom).toBe(1);
  });

  it('pinches from a fitted zoom to a number within 50–300%', async () => {
    const { sheet } = await showPage(1, 'fit-width');
    // jsdom lays nothing out, so fit width resolves to the 10% floor for tiny windows.
    expect(useViewStore.getState().renderedZoom).toBe(0.1);
    fireEvent.pointerDown(sheet(), touch(1, 100, 100));
    fireEvent.pointerDown(sheet(), touch(2, 200, 100));
    fireEvent.pointerMove(sheet(), touch(2, 300, 100));
    fireEvent.pointerUp(sheet(), touch(1, 100, 100));
    expect(useViewStore.getState().zoom).toBe(0.5);
  });

  it('starts nothing until the page has a zoom', async () => {
    const { sheet } = await showPage();
    useViewStore.getState().setRenderedZoom(null);
    fireEvent.pointerDown(sheet(), touch(1, 100, 100));
    fireEvent.pointerDown(sheet(), touch(2, 200, 100));
    fireEvent.pointerMove(sheet(), touch(2, 300, 100));
    expect(sheet().style.transform).toBe('');
  });

  it('stops the browser scrolling under two fingers, not one', async () => {
    const { area } = await showPage();
    expect(fireEvent.touchMove(area, { touches: [{}] })).toBe(true);
    expect(fireEvent.touchMove(area, { touches: [{}, {}] })).toBe(false);
  });

  it('drops a gesture in progress when the page view goes away', async () => {
    const { sheet } = await showPage();
    const element = sheet();
    fireEvent.pointerDown(element, touch(1, 100, 100));
    fireEvent.pointerDown(element, touch(2, 200, 100));
    fireEvent.pointerMove(element, touch(2, 300, 100));
    act(() => useDocumentStore.getState().update({ display: null }));
    expect(element.style.transform).toBe('');
  });
});

describe('WebKit gesture events (Safari on iPad and macOS)', () => {
  beforeEach(() => {
    vi.stubGlobal('GestureEvent', class {});
  });

  it('are cancelled everywhere, and zoom only when they start on the page', async () => {
    const { sheet } = await showPage();
    expect(hasGestureEvents()).toBe(true);
    // Outside the page area: the app does not zoom, and neither does Safari.
    expect(gesture(document.body, 'gesturestart', 1).defaultPrevented).toBe(true);
    expect(gesture(document.body, 'gesturechange', 2).defaultPrevented).toBe(true);
    expect(gesture(document.body, 'gestureend', 2).defaultPrevented).toBe(true);
    expect(useViewStore.getState().zoom).toBe(1);

    expect(gesture(sheet(), 'gesturestart', 1).defaultPrevented).toBe(true);
    expect(gesture(sheet(), 'gesturechange', 0.75, 120, 100).defaultPrevented).toBe(true);
    expect(sheet().style.transform).toBe(shift(20, 0.75));
    gesture(sheet(), 'gestureend', 0.75, 120, 100);
    expect(useViewStore.getState().zoom).toBe(0.75);
    expect(sheet().style.transform).toBe('');
  });

  it('leave touch pointers alone, so a pinch is not counted twice', async () => {
    const { sheet } = await showPage();
    fireEvent.pointerDown(sheet(), touch(1, 100, 100));
    fireEvent.pointerDown(sheet(), touch(2, 200, 100));
    fireEvent.pointerMove(sheet(), touch(2, 300, 100));
    expect(sheet().style.transform).toBe('');
  });
});

describe('Ctrl+wheel (trackpad pinch in Chrome, Edge and Firefox)', () => {
  it('zooms with Ctrl held and commits after a pause', async () => {
    const { area, sheet } = await showPage();
    vi.useFakeTimers();
    expect(fireEvent.wheel(sheet(), { deltaY: -50 })).toBe(true);
    expect(fireEvent.wheel(sheet(), { deltaY: -50, ctrlKey: true, clientX: 10 })).toBe(false);
    expect(sheet().style.transform).toMatch(/scale\(1\.64/);
    fireEvent.wheel(sheet(), { deltaY: -50, ctrlKey: true, clientX: 10 });
    act(() => vi.advanceTimersByTime(TIMING.wheelZoomSettleMs - 1));
    expect(useViewStore.getState().zoom).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(useViewStore.getState().zoom).toBe(2.72);
    expect(sheet().style.transform).toBe('');
    expect(area.scrollLeft).toBeGreaterThanOrEqual(0);
  });

  it('does not join a pinch already under way', async () => {
    const { sheet } = await showPage();
    fireEvent.pointerDown(sheet(), touch(1, 100, 100));
    fireEvent.pointerDown(sheet(), touch(2, 200, 100));
    expect(fireEvent.wheel(sheet(), { deltaY: -500, ctrlKey: true })).toBe(false);
    expect(sheet().style.transform).toBe(shift(0, 1));
  });

  it('does nothing before the page has a zoom', async () => {
    const { sheet } = await showPage();
    useViewStore.getState().setRenderedZoom(null);
    fireEvent.wheel(sheet(), { deltaY: -50, ctrlKey: true });
    expect(sheet().style.transform).toBe('');
  });
});

describe('render memory (V6)', () => {
  it('caps the hidden neighbors and renders a page sharp once it is current', async () => {
    const { display } = await showPage(3, 3);
    act(() => useViewStore.getState().setPage(1));
    await waitFor(() => expect(display.renders.length).toBeGreaterThanOrEqual(3));
    const pixels = (page: number) =>
      display.renders
        .filter((r) => r.page === page)
        .map((r) => r.options.pixelWidth * r.options.pixelHeight);
    // 816 × 1056 CSS px at 300% is 7.8 million pixels: the current page has them all.
    await waitFor(() => expect(Math.max(...pixels(1))).toBe(2448 * 3168));
    expect(Math.max(...pixels(2))).toBeLessThanOrEqual(LIMITS.neighborCanvasPixels);
    act(() => useViewStore.getState().setPage(2));
    await waitFor(() => expect(Math.max(...pixels(2))).toBe(2448 * 3168));
  });
});
