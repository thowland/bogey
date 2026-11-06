// The viewer components (V1–V3, V6, U2) against a fake pdf.js document.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ok, type PdfInfo } from '@bogey/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageControls } from '../src/features/viewer/PageControls.tsx';
import { PAGE_FAILED_TEXT, PageView } from '../src/features/viewer/PageView.tsx';
import { Thumbnails } from '../src/features/viewer/Thumbnails.tsx';
import { thumbnailCache } from '../src/features/viewer/thumbnailCache.ts';
import { ZoomControls } from '../src/features/viewer/ZoomControls.tsx';
import { useDocumentStore } from '../src/state/document.ts';
import { useViewStore } from '../src/state/view.ts';
import { fakeDocument, type FakeDocument } from './fakePdfjs.ts';

const drawImage = vi.fn();

beforeEach(() => {
  drawImage.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn((canvas: HTMLCanvasElement) =>
      Promise.resolve({ width: canvas.width, height: canvas.height, close: vi.fn() }),
    ),
  );
});

function show(display: FakeDocument, info: Partial<PdfInfo> = {}) {
  useDocumentStore.getState().update({
    status: 'ready',
    display,
    info: { formType: 'flat', ...info } as PdfInfo,
  });
}

describe('the page view (V1, V6)', () => {
  it('renders the current page and its neighbors, showing only the current one', async () => {
    const display = fakeDocument(5);
    show(display);
    useViewStore.getState().setPage(2);
    useViewStore.getState().setZoom(1);
    render(<PageView />);
    expect(screen.getByRole('region', { name: 'Page 3 of 5' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('[data-status="ready"]')).toHaveLength(3));
    const sheets = [...document.querySelectorAll<HTMLElement>('[data-page]')];
    expect(sheets.map((sheet) => [sheet.dataset.page, sheet.hidden])).toEqual([
      ['2', true],
      ['3', false],
      ['4', true],
    ]);
    expect(sheets[1]!.style.width).toBe('816px');
    expect(display.renders.map((r) => r.page).sort()).toEqual([1, 2, 3]);
    expect(display.renders[0]!.options).toMatchObject({ zoom: 1, annotations: 'all' });
    expect(useViewStore.getState().renderedZoom).toBe(1);
    expect(display.released).toContainEqual([2, 5]);
  });

  it('leaves form widgets out on AcroForm documents and re-renders on zoom', async () => {
    const display = fakeDocument(1);
    show(display, { formType: 'acroform' });
    useViewStore.getState().setZoom(1);
    render(<PageView />);
    await waitFor(() => expect(display.renders).toHaveLength(1));
    expect(display.renders[0]!.options.annotations).toBe('without-form-widgets');
    act(() => useViewStore.getState().setZoom(2));
    await waitFor(() => expect(display.renders).toHaveLength(2));
    await waitFor(() => expect(document.querySelectorAll('canvas')).toHaveLength(1));
    // The first canvas was released when the sharper one replaced it.
    expect(display.renders[0]!.canvas.width).toBe(0);
  });

  it('cancels a render nobody needs any more', async () => {
    const display = fakeDocument(1, { autoRender: false });
    show(display);
    useViewStore.getState().setZoom(1);
    render(<PageView />);
    await waitFor(() => expect(display.renders).toHaveLength(1));
    expect(document.querySelector('[data-status]')).toHaveAttribute('data-status', 'rendering');
    act(() => useViewStore.getState().setZoom(1.5));
    await waitFor(() => expect(display.renders[0]!.cancelled).toBe(true));
    display.renders[1]!.resolve();
    await waitFor(() =>
      expect(document.querySelector('[data-status]')).toHaveAttribute('data-status', 'ready'),
    );
  });

  it('says so when a page cannot be drawn', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const display = fakeDocument(1, { autoRender: false });
    show(display);
    render(<PageView />);
    await waitFor(() => expect(display.renders).toHaveLength(1));
    display.renders[0]!.reject(new Error('broken page'));
    expect(await screen.findByRole('alert')).toHaveTextContent(PAGE_FAILED_TEXT);
  });

  it('logs a page pdf.js cannot load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const display = fakeDocument(1);
    display.page = () => Promise.reject(new Error('no page'));
    show(display);
    render(<PageView />);
    await waitFor(() => expect(error).toHaveBeenCalled());
  });

  it('renders nothing without a document', () => {
    const { container } = render(<PageView />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the thumbnail strip (V2)', () => {
  it('draws each page once, caches it, and moves to the page clicked', async () => {
    const user = userEvent.setup();
    const display = fakeDocument(3);
    show(display);
    const { unmount } = render(<Thumbnails />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Page 1',
      'Page 2',
      'Page 3',
    ]);
    expect(buttons[0]).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(3));
    expect(display.renders.every((r) => r.options.zoom === 120 / 816)).toBe(true);
    expect(thumbnailCache(display).size).toBe(3);

    await user.click(buttons[2]!);
    expect(useViewStore.getState().page).toBe(2);
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
    expect(display.renders).toHaveLength(3);
    unmount();
    expect(thumbnailCache(display).size).toBe(0);
  });

  it('reuses cached bitmaps after a remount', async () => {
    const display = fakeDocument(1);
    show(display);
    const first = render(<Thumbnails />);
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1));
    const cache = thumbnailCache(display);
    first.unmount();
    // Unmounting drops the cache; put a bitmap back to check the cached path.
    thumbnailCache(display).set(0, { width: 1, height: 1, close: vi.fn() } as never);
    expect(cache).not.toBe(thumbnailCache(display));
    render(<Thumbnails />);
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
    expect(display.renders).toHaveLength(1);
  });

  it('logs a failed thumbnail and keeps going', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const display = fakeDocument(1, { autoRender: false });
    show(display);
    render(<Thumbnails />);
    await waitFor(() => expect(display.renders).toHaveLength(1));
    display.renders[0]!.reject(new Error('bad'));
    await waitFor(() => expect(error).toHaveBeenCalled());
  });

  it('renders nothing without a document', () => {
    const { container } = render(<Thumbnails />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('page controls (V3, U2)', () => {
  it('pages with the buttons and with [ and ], within the document', async () => {
    const user = userEvent.setup();
    show(fakeDocument(3));
    render(<PageControls />);
    const previous = screen.getByRole('button', { name: 'Previous page' });
    const next = screen.getByRole('button', { name: 'Next page' });
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(previous).toBeDisabled();
    await user.click(next);
    await user.keyboard(']');
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(next).toBeDisabled();
    await user.keyboard(']');
    expect(useViewStore.getState().page).toBe(2);
    await user.keyboard('[[');
    await user.click(previous);
    expect(useViewStore.getState().page).toBe(0);
  });

  it('ignores [ and ] while typing', () => {
    show(fakeDocument(3));
    render(
      <>
        <PageControls />
        <input aria-label="Name" />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: ']' });
    fireEvent.keyDown(window, { key: 'x' });
    expect(useViewStore.getState().page).toBe(0);
  });

  it('is absent until a document is ready', () => {
    const { container } = render(<PageControls />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('zoom controls (V3)', () => {
  it('steps in and out from the zoom shown', async () => {
    const user = userEvent.setup();
    show(fakeDocument(1));
    render(<ZoomControls />);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(useViewStore.getState().zoom).toBe(1.25);
    act(() => useViewStore.getState().setRenderedZoom(0.62));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(useViewStore.getState().zoom).toBe(0.5);
    act(() => useViewStore.getState().setRenderedZoom(0.5));
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    act(() => useViewStore.getState().setRenderedZoom(3));
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });

  it('chooses a preset from the menu by pointer and by keyboard', async () => {
    const user = userEvent.setup();
    show(fakeDocument(1));
    render(<ZoomControls />);
    const button = screen.getByRole('button', { name: 'Zoom level: Fit width' });
    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'Zoom level' });
    expect(within(menu).getByRole('menuitemradio', { name: 'Fit width' })).toHaveFocus();
    await user.click(within(menu).getByRole('menuitemradio', { name: '200%' }));
    expect(useViewStore.getState().zoom).toBe(2);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Zoom level: 200%' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitemradio', { name: '200%' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: '250%' })).toHaveFocus();
    await user.keyboard('{End}{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Fit width' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{Home}{ArrowDown}x{Enter}');
    expect(useViewStore.getState().zoom).toBe('fit-page');
  });

  it('closes on Escape, Tab and a click elsewhere', async () => {
    const user = userEvent.setup();
    show(fakeDocument(1));
    render(
      <>
        <ZoomControls />
        <button type="button">Elsewhere</button>
      </>,
    );
    const open = () => user.click(screen.getByRole('button', { name: /Zoom level/ }));
    await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /Zoom level/ })).toHaveFocus();
    await open();
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    await open();
    await user.click(screen.getByRole('menuitemradio', { name: '50%' }).parentElement!);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await open();
    await user.click(screen.getByRole('button', { name: /Zoom level/ }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows a zoom that is not a preset', () => {
    show(fakeDocument(1));
    useViewStore.getState().setZoom(1.37);
    render(<ZoomControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom level: 137%' }));
    expect(screen.getAllByRole('menuitemradio').at(-1)).toHaveAccessibleName('137%');
  });

  it('is absent until a document is ready', () => {
    const { container } = render(<ZoomControls />);
    expect(container).toBeEmptyDOMElement();
    expect(ok(0).ok).toBe(true);
  });
});
