// Settings (O3, O5), the keyboard shortcuts dialog (U2) and Close PDF (Sprint 7).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CloseButton } from '../src/features/open/index.ts';
import { ShortcutsHelp } from '../src/features/help/index.ts';
import { SHORTCUTS, isApple, isHelpKey, keyName } from '../src/features/help/shortcuts.ts';
import { SettingsMenu } from '../src/features/settings/index.ts';
import { formatExample } from '../src/features/settings/SettingsMenu.tsx';
import { useDocumentStore } from '../src/state/document.ts';
import { openRepository } from '../src/state/persistence.ts';
import { useSettingsStore } from '../src/state/settings.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { useViewStore } from '../src/state/view.ts';
import { fieldsInfo } from './fieldsInfo.ts';

describe('Settings', () => {
  it('changes the date format and default text size and saves them', async () => {
    const repository = await openRepository({ factory: null });
    useStorageStore.getState().attach(repository);
    render(<SettingsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const format = within(dialog).getByRole('combobox', { name: 'Date format' });
    expect(within(format).getAllByRole('option')).toHaveLength(4);
    await userEvent.selectOptions(format, 'YYYY-MM-DD');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Default text size' }),
      '14',
    );
    expect(useSettingsStore.getState()).toMatchObject({
      dateFormat: 'YYYY-MM-DD',
      defaultFontSize: 14,
    });
    await repository.flush();
    expect((await repository.get('settings', 'dateFormat'))?.value).toBe('YYYY-MM-DD');
    expect((await repository.get('settings', 'defaultFontSize'))?.value).toBe(14);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('ignores an unknown date format from the control', async () => {
    render(<SettingsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const format = screen.getByRole('combobox', { name: 'Date format' });
    fireEvent.change(format, { target: { value: 'nonsense' } });
    expect(useSettingsStore.getState().dateFormat).toBe('MM/DD/YYYY');
  });

  it('shows each format with an example', () => {
    const day = new Date(2026, 10, 6);
    expect(formatExample('MM/DD/YYYY', day)).toBe('11/06/2026');
    expect(formatExample('Month D, YYYY', day)).toBe('November 6, 2026');
  });

  it('keeps Clear everything beside it', () => {
    render(<SettingsMenu />);
    expect(screen.getByRole('button', { name: 'Clear everything' })).toBeInTheDocument();
  });
});

describe('keyboard shortcuts dialog', () => {
  it('opens with ? and with its button, and lists the shortcuts', async () => {
    render(<ShortcutsHelp />);
    fireEvent.keyDown(window, { key: '?' });
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const group of SHORTCUTS) {
      expect(within(dialog).getByRole('heading', { name: group.title })).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent('Download the signed copy.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('ignores ? while typing, in a dialog or with a modifier', () => {
    render(
      <>
        <input aria-label="Name" />
        <ShortcutsHelp />
      </>,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: '?' });
    fireEvent.keyDown(window, { key: '?', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const dialog = document.createElement('dialog');
    const inner = document.createElement('button');
    dialog.append(inner);
    expect(
      isHelpKey({ key: '?', metaKey: false, ctrlKey: false, altKey: false, target: inner }),
    ).toBe(false);
    expect(
      isHelpKey({ key: '/', metaKey: false, ctrlKey: false, altKey: false, target: null }),
    ).toBe(false);
  });

  it('names the command key for the device', () => {
    expect(isApple('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true);
    expect(isApple('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(keyName('Mod', true)).toBe('⌘');
    expect(keyName('Mod', false)).toBe('Ctrl');
    expect(keyName('T', true)).toBe('T');
  });
});

describe('Close PDF', () => {
  it('shows only with a document open, and returns to the empty state', async () => {
    const { rerender } = render(<CloseButton />);
    expect(screen.queryByRole('button', { name: 'Close PDF' })).not.toBeInTheDocument();
    useDocumentStore
      .getState()
      .update({ status: 'ready', name: 'f.pdf', info: fieldsInfo(), bytes: new Uint8Array([1]) });
    useViewStore.getState().setPage(1);
    useViewStore.getState().setScreen('help');
    rerender(<CloseButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Close PDF' }));
    await waitFor(() => expect(useDocumentStore.getState().status).toBe('empty'));
    expect(useViewStore.getState()).toMatchObject({ page: 0, screen: 'workspace' });
    expect(screen.queryByRole('button', { name: 'Close PDF' })).not.toBeInTheDocument();
  });
});
