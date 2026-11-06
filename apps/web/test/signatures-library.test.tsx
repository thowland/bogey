// The signature library: store, persistence and panel (spec §8.3, G1, G5).
import type { SignatureMeta } from '@bogey/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SignaturesPanel } from '../src/features/signatures/index.ts';
import { openRepository, type SignatureRecord } from '../src/state/persistence.ts';
import { useEditsStore } from '../src/state/edits.ts';
import {
  DEFAULT_NAMES,
  MAX_SIGNATURE_NAME,
  cleanName,
  useSignaturesStore,
} from '../src/state/signatures.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { useViewStore } from '../src/state/view.ts';
import { attachMemoryRepository } from './signatures-helpers.ts';

const png = (byte = 1) =>
  new Blob([new Uint8Array([137, 80, 78, 71, byte])], { type: 'image/png' });

const meta = (id: string, over: Partial<SignatureMeta> = {}): SignatureMeta => ({
  id,
  name: `Name ${id}`,
  kind: 'signature',
  width: 120,
  height: 40,
  createdAt: 1,
  ...over,
});

const record = (id: string, over: Partial<SignatureRecord> = {}): SignatureRecord => ({
  ...meta(id),
  png: new Uint8Array([137, 80, 78, 71]).buffer,
  ...over,
});

describe('cleanName', () => {
  it('trims, caps the length and falls back to the kind', () => {
    expect(cleanName('  Tim  ', 'signature')).toBe('Tim');
    expect(cleanName('   ', 'initials')).toBe(DEFAULT_NAMES.initials);
    expect(cleanName('x'.repeat(200), 'signature')).toHaveLength(MAX_SIGNATURE_NAME);
  });
});

describe('signatures store', () => {
  it('loads the library when the repository is attached, as Blobs', async () => {
    const repository = await openRepository({ factory: null });
    await repository.put('signatures', record('b', { createdAt: 5 }));
    await repository.put('signatures', record('a', { createdAt: 2 }));
    useStorageStore.getState().attach(repository);
    await waitFor(() => expect(useSignaturesStore.getState().loaded).toBe(true));
    const { items, images } = useSignaturesStore.getState();
    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(items[0]).not.toHaveProperty('png');
    expect(images.get('a')).toBeInstanceOf(Blob);
    expect(images.get('a')!.type).toBe('image/png');
  });

  it('keeps signatures added before the repository opened, and writes them', async () => {
    const added = await useSignaturesStore
      .getState()
      .add({ name: '', kind: 'initials', png: png(), width: 10, height: 5 });
    expect(added).toMatchObject({ name: 'Initials', kind: 'initials', width: 10 });
    const repository = await attachMemoryRepository();
    await repository.put('signatures', record('old', { createdAt: 0 }));
    await useSignaturesStore.getState().load(repository);
    expect(useSignaturesStore.getState().items.map((item) => item.id)).toEqual(['old', added.id]);
    const stored = await repository.get('signatures', added.id);
    expect(new Uint8Array(stored!.png)).toEqual(new Uint8Array([137, 80, 78, 71, 1]));
  });

  it('renames and removes, in memory and in the repository', async () => {
    const repository = await attachMemoryRepository();
    const store = useSignaturesStore.getState();
    const a = await store.add({ name: 'Mine', kind: 'signature', png: png(), width: 1, height: 1 });
    await store.rename(a.id, '  Formal ');
    await store.rename('missing', 'x');
    expect(useSignaturesStore.getState().items[0]!.name).toBe('Formal');
    expect((await repository.get('signatures', a.id))!.name).toBe('Formal');
    await store.remove(a.id);
    expect(useSignaturesStore.getState().items).toEqual([]);
    expect(useSignaturesStore.getState().images.size).toBe(0);
    expect(await repository.get('signatures', a.id)).toBeUndefined();
  });

  it('works in memory with no repository', async () => {
    const store = useSignaturesStore.getState();
    const a = await store.add({ name: 'A', kind: 'signature', png: png(), width: 1, height: 1 });
    await store.rename(a.id, 'B');
    await store.remove(a.id);
    expect(useSignaturesStore.getState().items).toEqual([]);
  });

  it('logs a library that cannot be read', async () => {
    const repository = await openRepository({ factory: null });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(repository, 'getAll').mockRejectedValueOnce(new Error('broken'));
    useStorageStore.getState().attach(repository);
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(useSignaturesStore.getState().loaded).toBe(false);
    error.mockRestore();
  });
});

describe('SignaturesPanel', () => {
  const seed = () =>
    useSignaturesStore.getState().setAll(
      [meta('s1', { name: 'Full' }), meta('i1', { name: 'TH', kind: 'initials' })],
      new Map([
        ['s1', png()],
        ['i1', png(2)],
      ]),
    );

  it('says what it is for when empty, and opens the draw and upload dialogs', async () => {
    const user = userEvent.setup();
    render(<SignaturesPanel />);
    expect(screen.getByText('Signatures you draw or upload are kept here.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Draw' }));
    expect(screen.getByRole('heading', { name: 'Draw a signature' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Draw a signature' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByRole('heading', { name: 'Upload a signature' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Upload a signature' })).toBeNull();
  });

  it('groups thumbnails by kind and enters place-signature mode', async () => {
    seed();
    const user = userEvent.setup();
    const { unmount } = render(<SignaturesPanel />);
    const signatures = screen.getByRole('region', { name: 'Signatures' });
    const initials = screen.getByRole('region', { name: 'Initials' });
    const place = within(signatures).getByRole('button', { name: 'Place Full' });
    expect(within(initials).getByRole('button', { name: 'Place TH' })).toBeInTheDocument();
    expect(place.querySelector('img')!.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.getByText(/Choose a signature/)).toBeInTheDocument();
    await user.click(place);
    expect(useViewStore.getState()).toMatchObject({ tool: 'signature', selectedSignatureId: 's1' });
    expect(place).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Click the page where the signature should go/)).toBeInTheDocument();
    await user.click(place);
    expect(useViewStore.getState()).toMatchObject({ tool: 'select', selectedSignatureId: null });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    unmount();
    expect(revoke).toHaveBeenCalledTimes(2);
    revoke.mockRestore();
  });

  it('renames a signature', async () => {
    const repository = await attachMemoryRepository();
    await repository.put('signatures', record('s1', { name: 'Full' }));
    await useSignaturesStore.getState().load(repository);
    const user = userEvent.setup();
    render(<SignaturesPanel />);
    await user.click(screen.getByRole('button', { name: 'Rename Full' }));
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveValue('Full');
    await user.clear(input);
    await user.type(input, 'Formal{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Place Formal' })).toBeInTheDocument();
    expect((await repository.get('signatures', 's1'))!.name).toBe('Formal');
    await user.click(screen.getByRole('button', { name: 'Rename Formal' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useSignaturesStore.getState().items[0]!.name).toBe('Formal');
  });

  it('asks before deleting, and names the pages where it is placed', async () => {
    seed();
    useViewStore.getState().chooseSignature('s1');
    useEditsStore.getState().load({
      fieldValues: {},
      overlays: [3, 1, 3].map((page, i) => ({
        id: `o${i}`,
        type: 'signature' as const,
        page,
        x: 0,
        y: 0,
        width: 100,
        height: 30,
        signatureId: 's1',
      })),
    });
    const user = userEvent.setup();
    render(<SignaturesPanel />);
    await user.click(screen.getByRole('button', { name: 'Delete TH' }));
    let dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Delete “TH”?');
    expect(within(dialog).queryByText(/placed on/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(useSignaturesStore.getState().items).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Delete Full' }));
    dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('It is placed on pages 2, 4 of the open document.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(useSignaturesStore.getState().items).toHaveLength(1));
    expect(useViewStore.getState()).toMatchObject({ tool: 'select', selectedSignatureId: null });
    expect(screen.queryByRole('region', { name: 'Signatures' })).toBeNull();
  });

  it('names a single page', async () => {
    seed();
    useEditsStore.getState().load({
      fieldValues: {},
      overlays: [
        { id: 'o', type: 'signature', page: 0, x: 0, y: 0, width: 1, height: 1, signatureId: 'i1' },
        { id: 't', type: 'text', page: 0, x: 0, y: 0, text: 'x', size: 10, bold: false },
      ],
    });
    const user = userEvent.setup();
    render(<SignaturesPanel />);
    await user.click(screen.getByRole('button', { name: 'Delete TH' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('It is placed on page 1 of');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(useSignaturesStore.getState().items).toHaveLength(1));
    // The selection belonged to another signature and stays as it was.
    expect(useViewStore.getState().tool).toBe('select');
  });
});
