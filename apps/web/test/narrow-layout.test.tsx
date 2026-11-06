// The layout below 1024 px (P3, spec §10.4): the thumbnail strip is behind a Pages toggle and the
// panel overlays the page, starting closed.
import type { PdfInfo } from '@bogey/core';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { useDocumentStore } from '../src/state/document.ts';
import { useViewStore } from '../src/state/view.ts';
import { fakeDocument } from './fakePdfjs.ts';

function matchWidth(width: number) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(max-width: 1023px)' && width < 1024,
      media: query,
    })),
  );
}

function openDocument() {
  useDocumentStore.getState().update({
    status: 'ready',
    display: fakeDocument(3),
    info: { formType: 'flat', pageCount: 3, pages: [], fields: [] } as unknown as PdfInfo,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('the narrow layout (P3)', () => {
  it('starts with the panel closed below 1024 px', () => {
    matchWidth(800);
    render(<App />);
    expect(useViewStore.getState().panelOpen).toBe(false);
    expect(screen.getByRole('button', { name: 'Show panel' })).toBeInTheDocument();
  });

  it('keeps the panel open on wider screens', () => {
    matchWidth(1280);
    render(<App />);
    expect(useViewStore.getState().panelOpen).toBe(true);
  });

  it('toggles the thumbnail strip, which closes when a page is chosen', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Pages' })).not.toBeInTheDocument();
    act(openDocument);
    const toggle = screen.getByRole('button', { name: 'Pages' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'thumbnail-strip');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide pages' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    act(() => useViewStore.getState().setPage(2));
    expect(screen.getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    await user.click(screen.getByRole('button', { name: 'Hide pages' }));
    expect(screen.getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-expanded', 'false');
  });
});
