// The open sequence and the page view with real pdf.js (V1, V5, spec §10.3): rotated pages draw
// at the right size, the backing store follows devicePixelRatio and stays under the pixel cap.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/config.ts';
import { closeDocument, openDocument } from '../src/features/open/openDocument.ts';
import { PageView } from '../src/features/viewer/PageView.tsx';
import { Thumbnails } from '../src/features/viewer/Thumbnails.tsx';
import { loadProblem } from '../src/pdfjs/loader.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useViewStore } from '../src/state/view.ts';
import { fixtureBytes } from './pdfFixtures.ts';

async function openFixture(path: string) {
  const bytes = await fixtureBytes(path);
  await openDocument(new File([bytes as BlobPart], path.split('/').pop()!));
  expect(useDocumentStore.getState().status).toBe('ready');
}

async function readyCanvas(page: number) {
  await waitFor(
    () =>
      expect(document.querySelector(`[data-page="${page}"][data-status="ready"]`)).not.toBeNull(),
    { timeout: 10_000 },
  );
  const sheet = document.querySelector<HTMLElement>(`[data-page="${page}"]`)!;
  return { sheet, canvas: sheet.querySelector('canvas')! };
}

afterEach(async () => {
  cleanup();
  await closeDocument();
  useViewStore.getState().reset();
  vi.unstubAllGlobals();
});

describe('the viewer with pdf.js', () => {
  it('draws every rotation upright at 100% and the device pixel ratio', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    await openFixture('vendored/generated/multipage-rotations.pdf');
    useViewStore.getState().setZoom(1);
    render(<PageView />);
    for (const page of [0, 1, 2, 3]) {
      useViewStore.getState().setPage(page);
      const { sheet, canvas } = await readyCanvas(page + 1);
      const size = await useDocumentStore.getState().display!.page(page);
      expect(sheet.style.width).toBe(`${size.size.width}px`);
      expect(canvas.width).toBe(Math.floor(size.size.width * 2));
      expect(canvas.height).toBe(Math.floor(size.size.height * 2));
      // Odd rotations are landscape on screen (V5).
      expect(size.size.width > size.size.height).toBe(page % 2 === 1);
    }
  });

  it('keeps one canvas under the 16.7 MP cap at 300% on a dense screen', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    await openFixture('vendored/generated/flat-single.pdf');
    useViewStore.getState().setZoom(3);
    render(<PageView />);
    const { canvas, sheet } = await readyCanvas(1);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(LIMITS.maxCanvasPixels);
    expect(canvas.width * canvas.height).toBeGreaterThan(LIMITS.maxCanvasPixels * 0.99);
    // CSS scales the capped canvas up to the full page size.
    expect(canvas.getBoundingClientRect().width).toBeCloseTo(
      sheet.getBoundingClientRect().width,
      0,
    );
  });

  it('fits the width of the page area', async () => {
    await openFixture('vendored/generated/rotate-90.pdf');
    render(
      <div style={{ width: 600, height: 400 }}>
        <PageView />
      </div>,
    );
    const { sheet } = await readyCanvas(1);
    const area = screen.getByRole('region', { name: 'Page 1 of 1' });
    expect(sheet.getBoundingClientRect().width).toBeCloseTo(area.clientWidth - 32, 0);
    expect(useViewStore.getState().renderedZoom).toBeGreaterThan(0);
  });

  it('draws thumbnails', async () => {
    await openFixture('vendored/generated/rotate-0.pdf');
    render(<Thumbnails />);
    const thumb = screen.getByRole('button', { name: 'Page 1' }).querySelector('canvas')!;
    await waitFor(() => expect(thumb.width).toBeGreaterThan(0), { timeout: 10_000 });
    expect(thumb.getBoundingClientRect().width).toBeCloseTo(LIMITS.thumbnailWidth, 0);
  });

  it('maps pdf.js errors to problems', () => {
    expect(loadProblem({ name: 'PasswordException', code: 1 })).toEqual({
      code: 'pdf.password-required',
    });
    expect(loadProblem({ name: 'PasswordException', code: 2 })).toEqual({
      code: 'pdf.password-wrong',
    });
    expect(loadProblem({ name: 'InvalidPDFException' })).toEqual({ code: 'pdf.damaged' });
    expect(loadProblem(undefined)).toEqual({ code: 'pdf.damaged' });
  });
});
