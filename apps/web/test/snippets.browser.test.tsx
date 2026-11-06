// Snippet reordering in a real browser (N3, spec §13): dnd-kit's keyboard sensor measures the
// rows, which jsdom cannot lay out. Space picks the snippet up, the arrow keys move it, Space drops
// it, and Escape puts it back; each step is announced.
import type { Snippet } from '@bogey/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SnippetsPanel } from '../src/features/snippets/index.ts';
import { useSnippetsStore } from '../src/state/snippets.ts';

const snippet = (id: string, label: string, order: number): Snippet => ({
  id,
  label,
  value: '',
  order,
});

const labels = () => useSnippetsStore.getState().items.map((item) => item.label);

afterEach(() => {
  cleanup();
  useSnippetsStore.getState().reset();
});

async function editing() {
  useSnippetsStore
    .getState()
    .setAll([snippet('a', 'Full name', 0), snippet('b', 'Phone', 1), snippet('c', 'Email', 2)]);
  render(<SnippetsPanel />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit snippets' }));
  return screen.getByRole('list', { name: 'Edit snippets' });
}

describe('reordering snippets with the keyboard', () => {
  it('moves a snippet down two places and announces it', async () => {
    const list = await editing();
    within(list).getByRole('button', { name: 'Move Full name' }).focus();
    await userEvent.keyboard(' ');
    await waitFor(() =>
      expect(document.body.textContent).toContain('Picked up Full name. It is in position 1 of 3.'),
    );
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard(' ');
    await waitFor(() => expect(labels()).toEqual(['Phone', 'Email', 'Full name']));
    await waitFor(() =>
      expect(document.body.textContent).toContain('Full name dropped in position 3 of 3.'),
    );
  });

  it('puts the snippet back on Escape', async () => {
    const list = await editing();
    within(list).getByRole('button', { name: 'Move Email' }).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(document.body.textContent).toContain('Moving cancelled. Email is back in position 3'),
    );
    expect(labels()).toEqual(['Full name', 'Phone', 'Email']);
  });
});
