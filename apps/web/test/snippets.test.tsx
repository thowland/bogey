// Snippets and settings (Sprint 7: N1–N4, M2, O3, O5, spec §10.4, §10.6): the stores and their
// persistence, filling and placing, import and export, and the panel.
import type { PageGeometry, PdfInfo, Rotation, Snippet } from '@bogey/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { screenToPdf } from '../src/core-bridge/geometry.ts';
import { SnippetsPanel } from '../src/features/snippets/index.ts';
import {
  exportSnippets,
  importSummary,
  readSnippetFile,
  type SaveDeps,
} from '../src/features/snippets/files.ts';
import {
  DEFAULT_INSET_PT,
  fitToField,
  insertSnippet,
  snippetAnchor,
  todayText,
} from '../src/features/snippets/insert.ts';
import { announcements } from '../src/features/snippets/SnippetsPanel.tsx';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { openRepository, type Repository } from '../src/state/persistence.ts';
import { useSettingsStore } from '../src/state/settings.ts';
import { defaultSnippets, useSnippetsStore } from '../src/state/snippets.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { useViewStore } from '../src/state/view.ts';
import { messageFor } from '../src/ui/messages.ts';
import { useToastStore } from '../src/ui/Toast.tsx';
import { FIELDS, fieldsInfo } from './fieldsInfo.ts';

const snippet = (id: string, label: string, value: string, order: number): Snippet => ({
  id,
  label,
  value,
  order,
});

const geometry = (index: number, rotate: Rotation = 0): PageGeometry => ({
  index,
  view: [0, 0, 612, 792],
  rotate,
  userUnit: 1,
});

function openFlat(rotate: Rotation = 0) {
  const info: PdfInfo = {
    formType: 'flat',
    xfa: 'none',
    encrypted: false,
    decryptable: true,
    pageCount: 2,
    pages: [geometry(0, rotate), geometry(1, rotate)],
    fields: [],
    initialValues: {},
    metadata: {},
  };
  useDocumentStore
    .getState()
    .update({ status: 'ready', name: 'a.pdf', info, bytes: new Uint8Array([1]) });
}

function openForm() {
  useDocumentStore
    .getState()
    .update({ status: 'ready', name: 'f.pdf', info: fieldsInfo(), bytes: new Uint8Array([1]) });
}

async function attachRepository(): Promise<Repository> {
  const repository = await openRepository({ factory: null });
  useStorageStore.getState().attach(repository);
  return repository;
}

const overlays = () => useEditsStore.getState().present.overlays;
const stored = async (repository: Repository) =>
  (await repository.getAll('snippets')).sort((a, b) => a.order - b.order);

// ── stores ──

describe('snippets store', () => {
  it('seeds the six N1 snippets on first run and marks the run done', async () => {
    const repository = await attachRepository();
    await waitFor(() => expect(useSnippetsStore.getState().loaded).toBe(true));
    const { items } = useSnippetsStore.getState();
    expect(items.map((s) => s.label)).toEqual([
      'Full name',
      'Address line 1',
      'Address line 2',
      'City/State/ZIP',
      'Phone',
      'Email',
    ]);
    expect(items.every((s) => s.value === '')).toBe(true);
    await repository.flush();
    expect(await stored(repository)).toHaveLength(6);
    expect(await repository.get('settings', 'dateFormat')).toEqual({
      key: 'dateFormat',
      value: 'MM/DD/YYYY',
    });
  });

  it('does not seed again once the first run is done, even with no snippets left', async () => {
    const repository = await openRepository({ factory: null });
    await repository.put('settings', { key: 'dateFormat', value: 'YYYY-MM-DD' });
    await useSnippetsStore.getState().load(repository);
    expect(useSnippetsStore.getState().items).toEqual([]);
    expect(await repository.getAll('snippets')).toEqual([]);
  });

  it('loads stored snippets in order, skips damaged records and repairs the numbering', async () => {
    const repository = await openRepository({ factory: null });
    await repository.put('snippets', snippet('b', 'B', '2', 7));
    await repository.put('snippets', snippet('a', 'A', '1', 3));
    await repository.put('snippets', { id: 'x', label: 5 } as unknown as Snippet);
    await useSnippetsStore.getState().load(repository);
    expect(useSnippetsStore.getState().items).toEqual([
      snippet('a', 'A', '1', 0),
      snippet('b', 'B', '2', 1),
    ]);
    const saved = await repository.get('snippets', 'b');
    expect(saved?.order).toBe(1);
  });

  it('adds, edits, reorders and removes, saving each change', async () => {
    const repository = await attachRepository();
    await waitFor(() => expect(useSnippetsStore.getState().loaded).toBe(true));
    const store = useSnippetsStore.getState();
    const first = store.items[0]!;
    await store.edit(first.id, { value: 'Ada Lovelace' });
    await store.edit(first.id, { value: 'Ada Lovelace' }); // no change, no write
    await store.edit('missing', { value: 'x' });
    const added = await store.add('Employer');
    expect(added.order).toBe(6);
    await store.edit(added.id, { label: 'x'.repeat(100), value: 'v'.repeat(3000) });
    let items = useSnippetsStore.getState().items;
    expect([...items.at(-1)!.label]).toHaveLength(60);
    expect(items.at(-1)!.value).toHaveLength(2000);

    await store.reorder([added.id, first.id]);
    items = useSnippetsStore.getState().items;
    expect(items.slice(0, 2).map((s) => s.id)).toEqual([added.id, first.id]);
    expect(items.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    await store.remove(first.id);
    await repository.flush();
    const saved = await stored(repository);
    expect(saved.map((s) => s.id)).toEqual(useSnippetsStore.getState().items.map((s) => s.id));
    expect(saved.find((s) => s.id === first.id)).toBeUndefined();
    expect(saved.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('works in memory without a repository', async () => {
    const store = useSnippetsStore.getState();
    store.setAll(defaultSnippets());
    await store.edit(useSnippetsStore.getState().items[0]!.id, { value: 'x' });
    expect(useSnippetsStore.getState().items[0]!.value).toBe('x');
  });
});

describe('settings store', () => {
  it('loads saved settings and ignores values it does not recognise', async () => {
    const repository = await openRepository({ factory: null });
    await repository.put('settings', { key: 'dateFormat', value: 'Month D, YYYY' });
    await repository.put('settings', { key: 'defaultFontSize', value: 14 });
    await useSettingsStore.getState().load(repository);
    expect(useSettingsStore.getState()).toMatchObject({
      dateFormat: 'Month D, YYYY',
      defaultFontSize: 14,
      loaded: true,
    });

    useSettingsStore.getState().reset();
    await repository.put('settings', { key: 'dateFormat', value: 'nonsense' as never });
    await repository.put('settings', { key: 'defaultFontSize', value: 99 });
    await useSettingsStore.getState().load(repository);
    expect(useSettingsStore.getState()).toMatchObject({
      dateFormat: 'MM/DD/YYYY',
      defaultFontSize: 10,
    });
  });

  it('saves changes at once and refuses invalid ones', async () => {
    const repository = await attachRepository();
    const store = useSettingsStore.getState();
    await store.change({ dateFormat: 'DD MMM YYYY', defaultFontSize: 12 });
    await store.change({ defaultFontSize: 12.5 });
    await store.change({ dateFormat: 'bad' as never });
    expect(useSettingsStore.getState()).toMatchObject({
      dateFormat: 'DD MMM YYYY',
      defaultFontSize: 12,
    });
    await repository.flush();
    expect((await repository.get('settings', 'defaultFontSize'))?.value).toBe(12);
    expect((await repository.get('settings', 'dateFormat'))?.value).toBe('DD MMM YYYY');
  });

  it('changes in memory without a repository', async () => {
    await useSettingsStore.getState().change({ defaultFontSize: 20 });
    expect(useSettingsStore.getState().defaultFontSize).toBe(20);
  });
});

// ── filling and placing (N2, N4) ──

describe('insertSnippet', () => {
  it('does nothing without a document or a value', () => {
    expect(insertSnippet('x')).toEqual({ kind: 'none' });
    openFlat();
    expect(insertSnippet('')).toEqual({ kind: 'none' });
    expect(overlays()).toEqual([]);
  });

  it('fills the target text field, fitted to it', () => {
    openForm();
    useViewStore.getState().setTargetField('form.name');
    expect(insertSnippet('Ada\nLovelace')).toEqual({ kind: 'field', label: 'Your name' });
    expect(useEditsStore.getState().present.fieldValues['form.name']).toBe('Ada Lovelace');

    useViewStore.getState().setTargetField('form.ssn');
    insertSnippet('1234567890123');
    expect(useEditsStore.getState().present.fieldValues['form.ssn']).toBe('123456789');

    useViewStore.getState().setTargetField('form.notes');
    insertSnippet('a\nb');
    expect(useEditsStore.getState().present.fieldValues['form.notes']).toBe('a\nb');
    expect(overlays()).toEqual([]);
  });

  it('places an overlay instead when the target is not a fillable text field', () => {
    openForm();
    useViewStore.getState().setTargetField('form.fixed');
    expect(insertSnippet('x')).toEqual({ kind: 'overlay', page: 0 });
    useViewStore.getState().setTargetField('form.gone');
    expect(insertSnippet('y').kind).toBe('overlay');
  });

  it('places a text overlay 36 pt in from the top-left at the default size', () => {
    openFlat();
    useSettingsStore.getState().update({ defaultFontSize: 12 });
    expect(insertSnippet('Ada')).toEqual({ kind: 'overlay', page: 0 });
    expect(overlays()[0]).toMatchObject({
      type: 'text',
      page: 0,
      x: DEFAULT_INSET_PT,
      y: 792 - DEFAULT_INSET_PT - 12,
      text: 'Ada',
      size: 12,
      bold: false,
    });
  });

  it('places at the last point clicked on this page, then one line below for the next', () => {
    openFlat();
    useViewStore.getState().setLastPoint({ page: 0, point: { x: 100.4, y: 500.2 } });
    insertSnippet('Line one\nLine two');
    insertSnippet('Next');
    const [a, b] = overlays();
    expect(a).toMatchObject({ x: 100, y: 500 });
    expect(b).toMatchObject({ x: 100, y: 500 - 2 * 1.2 * 10 });
  });

  it('ignores a last point on another page', () => {
    openFlat();
    useViewStore.getState().setLastPoint({ page: 1, point: { x: 300, y: 300 } });
    insertSnippet('Ada');
    expect(overlays()[0]).toMatchObject({ page: 0, x: 36 });
  });

  it('places the Today date as a date overlay', () => {
    openFlat();
    useSettingsStore.getState().update({ dateFormat: 'YYYY-MM-DD' });
    const today = todayText(new Date(2026, 10, 6));
    expect(today).toBe('2026-11-06');
    insertSnippet(today, { date: true });
    expect(overlays()[0]).toMatchObject({ type: 'date', text: '2026-11-06' });
  });

  it('measures the default spot from the top-left of the page as shown, on every rotation', () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      const g = geometry(0, rotate);
      const at = snippetAnchor(g, 0, 10, null);
      const corner = screenToPdf(g, { x: 0, y: 0 }, 1);
      const inset = Math.hypot(at.x - corner.x, at.y - corner.y);
      expect(inset).toBeCloseTo(Math.hypot(36, 46), 6);
    }
  });

  it('fitToField leaves values alone when nothing limits them', () => {
    const field = FIELDS.find((f) => f.name === 'form.pin')!;
    expect(fitToField(field, 'abc')).toBe('abc');
  });
});

// ── files (M2) ──

const fileOf = (text: string, size = new TextEncoder().encode(text).length) => ({
  size,
  text: () => Promise.resolve(text),
});

const exported = (snippets: { label: string; value: string }[]) =>
  JSON.stringify({ bogeySnippets: 1, exportedAt: '2026-11-06T00:00:00Z', snippets });

describe('snippet files', () => {
  it('refuses a file over 256 KB without reading it', async () => {
    const text = vi.fn();
    const result = await readSnippetFile({ size: 256 * 1024 + 1, text });
    expect(result).toEqual({
      ok: false,
      problem: { code: 'snippets.too-large', data: { limit: 'file' } },
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('reports a file that cannot be read or parsed as malformed', async () => {
    const unreadable = { size: 1, text: () => Promise.reject(new Error('gone')) };
    expect(await readSnippetFile(unreadable)).toMatchObject({
      ok: false,
      problem: { code: 'snippets.malformed' },
    });
    expect(await readSnippetFile(fileOf('{"x":1}'))).toMatchObject({ ok: false });
  });

  it('plans an import against the current snippets', async () => {
    const existing = [snippet('a', 'Full name', 'Ada', 0), snippet('b', 'Email', '', 1)];
    const result = await readSnippetFile(
      fileOf(
        exported([
          { label: 'email', value: 'ada@example.com' },
          { label: 'Full name', value: 'Ada' },
          { label: 'Phone', value: '555' },
        ]),
      ),
      existing,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({ added: 1, overwritten: ['Email'], unchanged: 1 });
    expect(result.plan.next.map((s) => [s.label, s.value])).toEqual([
      ['Full name', 'Ada'],
      ['Email', 'ada@example.com'],
      ['Phone', '555'],
    ]);
  });

  it('summarises an import in one sentence', () => {
    expect(importSummary({ added: 0, overwritten: [] })).toBe(
      'Your snippets already match that file.',
    );
    expect(importSummary({ added: 1, overwritten: [] })).toBe('Added 1 snippet.');
    expect(importSummary({ added: 0, overwritten: ['A', 'B'] })).toBe('Updated 2 snippets.');
    expect(importSummary({ added: 2, overwritten: ['A'] })).toBe('Added 2 snippets and updated 1.');
  });

  it('exports bogey-snippets.json and revokes the URL later', async () => {
    let blob: Blob | null = null;
    let anchor: HTMLAnchorElement | null = null;
    const later: (() => void)[] = [];
    const deps: SaveDeps = {
      createUrl: (b) => {
        blob = b;
        return 'blob:snippets';
      },
      revokeUrl: vi.fn(),
      click: (a) => {
        anchor = a;
      },
      later: (run) => later.push(run),
    };
    exportSnippets(
      [snippet('b', 'Email', 'e', 1), snippet('a', 'Name', 'n', 0)],
      deps,
      new Date('2026-11-06T14:30:00Z'),
    );
    expect(anchor!.download).toBe('bogey-snippets.json');
    expect(JSON.parse(await blob!.text())).toEqual({
      bogeySnippets: 1,
      exportedAt: '2026-11-06T14:30:00Z',
      snippets: [
        { label: 'Name', value: 'n' },
        { label: 'Email', value: 'e' },
      ],
    });
    later.forEach((run) => run());
    expect(deps.revokeUrl).toHaveBeenCalledWith('blob:snippets');
  });

  it('words each too-large limit', () => {
    const text = (limit: string) => messageFor({ code: 'snippets.too-large', data: { limit } });
    expect(text('file')).toContain('256 KB');
    expect(text('count')).toContain('200 snippets');
    expect(text('label')).toContain('60 characters');
    expect(text('value')).toContain('2,000 characters');
    expect(text('other')).toBe(text('file'));
    expect(messageFor({ code: 'snippets.too-large' })).toBe(text('file'));
  });
});

// ── the panel ──

const panelList = () => screen.getByRole('list', { name: 'Snippets' });
const snippetButton = (name: string) => within(panelList()).getByRole('button', { name });

function seed(items: Snippet[] = defaultSnippets()) {
  useSnippetsStore.getState().setAll(items);
}

describe('SnippetsPanel', () => {
  it('shows Today first and the snippets, disabled until a document is open', () => {
    seed();
    render(<SnippetsPanel />);
    const buttons = within(panelList()).getAllByRole('button');
    expect(buttons.map((b) => b.querySelector('span')!.textContent)).toEqual([
      'Today',
      'Full name',
      'Address line 1',
      'Address line 2',
      'City/State/ZIP',
      'Phone',
      'Email',
    ]);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByTestId('snippet-target')).toHaveTextContent(
      'Open a PDF to use your snippets.',
    );
  });

  it('explains an empty profile', () => {
    render(<SnippetsPanel />);
    expect(screen.getByText(/Choose Edit snippets to add/)).toBeInTheDocument();
  });

  it('fills the target field and keeps focus where it was', async () => {
    seed([snippet('a', 'Full name', 'Ada Lovelace', 0), snippet('b', 'Phone', '', 1)]);
    openForm();
    render(
      <>
        <input aria-label="Your name" data-testid="field" />
        <SnippetsPanel />
      </>,
    );
    const field = screen.getByTestId('field');
    field.focus();
    act(() => useViewStore.getState().setTargetField('form.name'));
    expect(screen.getByTestId('snippet-target')).toHaveTextContent('Fills: Your name');
    expect(snippetButton('Phone')).toBeDisabled();
    expect(snippetButton('Phone')).toHaveAccessibleDescription(
      'Empty. Choose Edit snippets to fill it in.',
    );

    const button = snippetButton('Full name');
    expect(fireEvent.pointerDown(button)).toBe(false); // default prevented
    expect(field).toHaveFocus();
    fireEvent.click(button);
    expect(useEditsStore.getState().present.fieldValues['form.name']).toBe('Ada Lovelace');
    expect(screen.getByText('Filled Your name with Full name.')).toBeInTheDocument();
  });

  it('places overlays and says where the next one goes', async () => {
    seed([snippet('a', 'Full name', 'Ada', 0)]);
    openFlat();
    render(<SnippetsPanel />);
    expect(screen.getByTestId('snippet-target')).toHaveTextContent(/top-left corner/);
    await userEvent.click(snippetButton('Full name'));
    expect(overlays()).toHaveLength(1);
    expect(screen.getByText('Placed Full name on page 1.')).toBeInTheDocument();
    expect(screen.getByTestId('snippet-target')).toHaveTextContent(/where you last clicked/);
    await userEvent.click(snippetButton('Today'));
    expect(overlays()[1]).toMatchObject({ type: 'date', text: todayText() });
  });

  it('follows the date format setting on the Today button', () => {
    useSettingsStore.getState().update({ dateFormat: 'YYYY-MM-DD' });
    render(<SnippetsPanel />);
    expect(snippetButton('Today')).toHaveAccessibleDescription(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('edits labels and values inline, adds and deletes', async () => {
    seed([snippet('a', 'Full name', '', 0), snippet('b', 'Phone', '', 1)]);
    render(<SnippetsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit snippets' }));
    const first = screen.getByRole('group', { name: 'Snippet 1' });
    await userEvent.type(within(first).getByLabelText('Value'), 'Ada');
    await userEvent.clear(within(first).getByLabelText('Label'));
    await userEvent.type(within(first).getByLabelText('Label'), 'Name');
    expect(useSnippetsStore.getState().items[0]).toMatchObject({ label: 'Name', value: 'Ada' });

    await userEvent.click(screen.getByRole('button', { name: 'Add snippet' }));
    const third = screen.getByRole('group', { name: 'Snippet 3' });
    expect(within(third).getByLabelText('Label')).toHaveFocus();
    expect(within(third).getByRole('button', { name: 'Move Untitled' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete Phone' }));
    expect(useSnippetsStore.getState().items.map((s) => s.label)).toEqual(['Name', '']);

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(snippetButton('Name')).toBeInTheDocument();
    expect(snippetButton('Untitled')).toBeDisabled();
  });

  it('imports at once when nothing is overwritten', async () => {
    seed([snippet('a', 'Full name', 'Ada', 0)]);
    render(<SnippetsPanel />);
    const input = screen.getByTestId('snippets-import-input');
    const file = new File([exported([{ label: 'Phone', value: '555' }])], 'bogey-snippets.json');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(useSnippetsStore.getState().items).toHaveLength(2));
    expect(useToastStore.getState().items.map((t) => t.text)).toEqual(['Added 1 snippet.']);
  });

  it('asks before overwriting, listing the labels, and can be cancelled', async () => {
    seed([snippet('a', 'Full name', 'Ada', 0), snippet('b', 'Email', 'old', 1)]);
    render(<SnippetsPanel />);
    const input = screen.getByTestId('snippets-import-input');
    const json = exported([
      { label: 'EMAIL', value: 'new' },
      { label: 'Phone', value: '555' },
    ]);
    fireEvent.change(input, { target: { files: [new File([json], 's.json')] } });
    let dialog = await screen.findByRole('dialog', { name: 'Overwrite snippets?' });
    expect(within(dialog).getByRole('listitem')).toHaveTextContent('Email');
    expect(dialog).toHaveTextContent('It also adds 1 new snippet.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(useSnippetsStore.getState().items.map((s) => s.value)).toEqual(['Ada', 'old']);

    fireEvent.change(input, { target: { files: [new File([json], 's.json')] } });
    dialog = await screen.findByRole('dialog', { name: 'Overwrite snippets?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(useSnippetsStore.getState().items.map((s) => [s.label, s.value])).toEqual([
      ['Full name', 'Ada'],
      ['Email', 'new'],
      ['Phone', '555'],
    ]);
  });

  it('shows why a file was refused, and nothing changes', async () => {
    seed([snippet('a', 'Full name', 'Ada', 0)]);
    render(<SnippetsPanel />);
    const input = screen.getByTestId('snippets-import-input');
    fireEvent.change(input, { target: { files: [new File(['not json'], 's.json')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That file is not a Bogey snippets file, so nothing was imported.',
    );
    fireEvent.change(input, { target: { files: [] } });
    expect(useSnippetsStore.getState().items).toHaveLength(1);
  });

  it('exports from the panel', async () => {
    seed([snippet('a', 'Full name', 'Ada', 0)]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<SnippetsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});

describe('reorder announcements', () => {
  const items = [snippet('a', 'Full name', '', 0), snippet('b', ' ', '', 1)];
  const a = announcements(items);
  const active = (id: string) => ({ id }) as never;

  it('say what moved and where', () => {
    expect(a.onDragStart({ active: active('a') })).toBe(
      'Picked up Full name. It is in position 1 of 2.',
    );
    expect(a.onDragOver!({ active: active('a'), over: active('a') })).toBeUndefined();
    expect(a.onDragOver!({ active: active('a'), over: active('b') })).toBe(
      'Full name moved to position 2 of 2.',
    );
    expect(a.onDragOver!({ active: active('a'), over: active('b') })).toBeUndefined();
    expect(a.onDragOver!({ active: active('a'), over: null })).toBeUndefined();
    expect(a.onDragEnd({ active: active('b'), over: active('a') })).toBe(
      'Untitled dropped in position 1 of 2.',
    );
    expect(a.onDragEnd({ active: active('b'), over: null })).toBe('Untitled dropped.');
    expect(a.onDragCancel({ active: active('a'), over: null })).toBe(
      'Moving cancelled. Full name is back in position 1 of 2.',
    );
  });
});
