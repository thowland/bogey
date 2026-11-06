// The open UI (D1, D3, U2): drop zone, file pickers, Cmd/Ctrl+O and the password dialog.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { isOpenShortcut } from '../src/features/open/FilePicker.tsx';
import { PasswordDialog } from '../src/features/open/PasswordDialog.tsx';
import { askPassword } from '../src/features/open/passwordPrompt.ts';
import { setPdfjsLoader } from '../src/pdfjs/index.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { fakeLoader, pdfFile } from './fakePdfjs.ts';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => setPdfjsLoader(null));

const dataTransfer = (files: File[], types = ['Files']) => ({ files, types, dropEffect: 'none' });

describe('the drop zone (D1)', () => {
  it('opens a dropped PDF', async () => {
    setPdfjsLoader(fakeLoader({ pageCount: 2 }));
    render(<App />);
    const zone = screen.getByRole('region', { name: 'Open a PDF' });
    fireEvent.dragEnter(zone, { dataTransfer: dataTransfer([]) });
    expect(zone.className).toMatch(/over/);
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toMatch(/over/);
    fireEvent.drop(zone, { dataTransfer: dataTransfer([pdfFile('dropped.pdf')]) });
    await waitFor(() => expect(useDocumentStore.getState().status).toBe('ready'));
    expect(useDocumentStore.getState().name).toBe('dropped.pdf');
    expect(screen.getByRole('region', { name: 'Page 1 of 2' })).toBeInTheDocument();
  });

  it('ignores drags that carry no files, and drops with no file', () => {
    render(<App />);
    const zone = screen.getByRole('region', { name: 'Open a PDF' });
    const over = fireEvent.dragOver(zone, { dataTransfer: dataTransfer([], ['text/uri-list']) });
    expect(over).toBe(true);
    fireEvent.drop(zone, { dataTransfer: dataTransfer([], ['text/uri-list']) });
    fireEvent.drop(zone, { dataTransfer: dataTransfer([]) });
    expect(useDocumentStore.getState().status).toBe('empty');
  });

  it('shows progress and failures in plain language (U6)', () => {
    useDocumentStore.getState().update({ status: 'opening', name: 'w9.pdf' });
    const { rerender } = render(<App />);
    expect(screen.getByText('Opening w9.pdf…')).toBeInTheDocument();
    act(() =>
      useDocumentStore.getState().update({ status: 'error', problem: { code: 'file.not-pdf' } }),
    );
    rerender(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent(/not a PDF/);
  });
});

describe('the file pickers (D1, U2)', () => {
  it('opens the chosen file from either button, and clears the input', async () => {
    setPdfjsLoader(fakeLoader());
    const user = userEvent.setup();
    render(<App />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type=file]');
    expect(inputs).toHaveLength(2);
    const click = vi.spyOn(inputs[1]!, 'click');
    await user.click(screen.getByRole('button', { name: 'Choose a PDF' }));
    expect(click).toHaveBeenCalled();
    await user.upload(inputs[1]!, pdfFile('chosen.pdf'));
    await waitFor(() => expect(useDocumentStore.getState().name).toBe('chosen.pdf'));
    expect(inputs[1]!.value).toBe('');
    fireEvent.change(inputs[0]!, { target: { files: [] } });
  });

  it('answers Cmd/Ctrl+O from the toolbar button only', () => {
    render(<App />);
    const toolbarInput = screen.getByTestId('open-input');
    const click = vi.spyOn(toolbarInput, 'click');
    fireEvent.keyDown(window, { key: 'o', metaKey: true });
    fireEvent.keyDown(window, { key: 'O', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'o' });
    expect(click).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Open PDF' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+O Control+O',
    );
  });

  it('recognizes only the plain open shortcut', () => {
    const keys = { key: 'o', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false };
    expect(isOpenShortcut(keys)).toBe(true);
    expect(isOpenShortcut({ ...keys, shiftKey: true })).toBe(false);
    expect(isOpenShortcut({ ...keys, altKey: true })).toBe(false);
    expect(isOpenShortcut({ ...keys, ctrlKey: false })).toBe(false);
    expect(isOpenShortcut({ ...keys, key: 'p' })).toBe(false);
  });
});

describe('the password dialog (D3)', () => {
  it('sends the password, then asks again after a wrong one', async () => {
    const user = userEvent.setup();
    useDocumentStore.getState().update({ name: 'locked.pdf' });
    render(<PasswordDialog />);
    let answer!: Promise<string | null>;
    act(() => {
      answer = askPassword({ code: 'pdf.password-required' });
    });
    expect(screen.getByRole('dialog', { name: 'Password required' })).toBeInTheDocument();
    expect(screen.getByText('locked.pdf')).toBeInTheDocument();
    expect(screen.getByText(/password-protected/)).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Open' });
    expect(open).toBeDisabled();
    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
    await user.type(field, 'guess');
    await user.click(open);
    expect(await answer).toBe('guess');
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();

    act(() => {
      answer = askPassword({ code: 'pdf.password-wrong' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/did not open/);
    expect(screen.getByLabelText('Password')).toHaveValue('');
    await user.type(screen.getByLabelText('Password'), 'right{Enter}');
    expect(await answer).toBe('right');
  });

  it('cancels with the button or Escape', async () => {
    const user = userEvent.setup();
    render(<PasswordDialog />);
    let answer!: Promise<string | null>;
    act(() => {
      answer = askPassword({ code: 'pdf.password-required' });
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await answer).toBeNull();
    act(() => {
      answer = askPassword({ code: 'pdf.password-required' });
    });
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(await answer).toBeNull();
  });

  it('ignores an empty submission', () => {
    render(<PasswordDialog />);
    act(() => void askPassword({ code: 'pdf.password-required' }));
    fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });
});
