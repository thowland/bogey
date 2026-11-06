import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { useDocumentStore } from '../src/state/document.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { useViewStore } from '../src/state/view.ts';
import { openRepository } from '../src/state/persistence.ts';

describe('App shell (U1, U5)', () => {
  it('shows the empty state with the privacy statement', () => {
    render(<App />);
    expect(screen.getByText('Bogey')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Open a PDF' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent documents' })).toBeInTheDocument();
    expect(screen.getByText(/works entirely inside this browser/)).toBeInTheDocument();
  });

  it('switches the side panel between its three tabs', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = screen.getByRole('complementary', { name: /fields, snippets and signatures/i });
    expect(within(panel).getByRole('tab', { name: 'Fields' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(within(panel).getByRole('tab', { name: 'Signatures' }));
    expect(within(panel).getByText(/Signatures you draw/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('tab', { name: 'Snippets' }));
    expect(within(panel).getByText(/details you reuse/)).toBeInTheDocument();
  });

  it('collapses and restores the side panel', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(useViewStore.getState().panelOpen).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Show panel' }));
    expect(useViewStore.getState().panelOpen).toBe(true);
  });

  it('opens Help, About and Privacy in place of the workspace and returns', async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const [link, heading] of [
      ['Help', 'Help'],
      ['About', 'About Bogey'],
      ['Privacy', 'Privacy'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: link }));
      expect(screen.getByRole('heading', { level: 1, name: heading })).toHaveFocus();
      await user.click(screen.getByRole('button', { name: /back to your document/i }));
      expect(screen.queryByRole('heading', { level: 1, name: heading })).toBeNull();
    }
  });

  it('links the privacy statement to the Privacy page', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'How to check this yourself' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
  });

  it('shows the page view once a document is ready', () => {
    useDocumentStore.getState().update({ status: 'ready' });
    render(<App />);
    expect(screen.queryByRole('region', { name: 'Open a PDF' })).toBeNull();
  });

  it('shows the memory-mode banner when storage is unavailable (M3)', async () => {
    useStorageStore.getState().attach(await openRepository({ factory: null }));
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent(/not letting Bogey save/);
  });
});
