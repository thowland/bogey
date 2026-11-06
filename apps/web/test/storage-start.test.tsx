// Restore, the recent list, Clear everything and the storage notices (Sprint 6: D5–D7, S7, M3,
// spec §11.7) with fake-indexeddb, a fake pdf.js loader and a stub core bridge.
import 'fake-indexeddb/auto';
import { fail, ok, type PdfInfo } from '@bogey/core';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubPdfBridge, type PdfBridge } from '../src/core-bridge/pdf.ts';
import { RecentDocuments } from '../src/features/open/RecentDocuments.tsx';
import { openDocument } from '../src/features/open/openDocument.ts';
import type { OpenServices } from '../src/features/open/openSteps.ts';
import { ClearEverything } from '../src/features/settings/ClearEverything.tsx';
import { SettingsMenu } from '../src/features/settings/SettingsMenu.tsx';
import {
  clearEverything,
  deleteSaved,
  openSaved,
  StorageBanner,
  startSession,
} from '../src/features/storage/index.ts';
import { stopSession } from '../src/features/storage/start.ts';
import { recordThumbnail } from '../src/features/storage/thumbnail.ts';
import { pageImageInfo } from '../src/features/storage/undecryptable.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { openRepository, type DocumentRecord, type Repository } from '../src/state/persistence.ts';
import {
  provisionalRecord,
  readSetting,
  useSessionStore,
  writeSetting,
} from '../src/state/session.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { useViewStore } from '../src/state/view.ts';
import { fakeDocument, fakeLoader, pdfFile, type FakeLoader } from './fakePdfjs.ts';

const NOW = Date.now();
const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF');

const bridge = (pageCount = 3): PdfBridge => ({
  ...stubPdfBridge,
  inspect: (_bytes, password) =>
    Promise.resolve(
      ok({
        formType: 'flat',
        xfa: 'none',
        encrypted: password !== undefined,
        decryptable: true,
        pageCount,
        pages: [],
        fields: [],
        initialValues: {},
        metadata: {},
      } satisfies PdfInfo),
    ),
});

/** An encrypted file: core and pdf.js both want `secret`. */
const encryptedBridge = (secret: string): PdfBridge => ({
  ...bridge(),
  inspect: (bytes, password) =>
    password === secret
      ? bridge().inspect(bytes, password)
      : Promise.resolve(
          fail({ code: password === undefined ? 'pdf.password-required' : 'pdf.password-wrong' }),
        ),
});

function services(overrides: Partial<OpenServices> = {}): OpenServices {
  return {
    bridge: bridge(),
    loader: fakeLoader(),
    askPassword: () => Promise.resolve(null),
    ...overrides,
  };
}

const record = (id: string, patch: Partial<DocumentRecord> = {}): DocumentRecord => ({
  ...provisionalRecord(id, `${id}.pdf`, NOW),
  pageCount: 3,
  ...patch,
});

async function seed(repository: Repository, saved: DocumentRecord, bytes = true) {
  await repository.put('documents', saved);
  if (bytes) {
    await repository.put('documentBytes', {
      id: saved.id,
      bytes: PDF.slice().buffer,
      size: PDF.byteLength,
      sha256: '',
    });
  }
}

async function repo(): Promise<Repository> {
  const repository = await openRepository({ factory: new IDBFactory() });
  useStorageStore.getState().attach(repository);
  return repository;
}

const quiet = { makeThumbnail: () => Promise.resolve(null) };

const settle = async (repository: Repository) => {
  for (let i = 0; i < 5; i++) {
    await repository.flush();
    await new Promise((resolve) => setImmediate(resolve));
  }
};

afterEach(() => {
  stopSession();
  useSessionStore.getState().reset();
  vi.restoreAllMocks();
});

describe('restore on load (D7)', () => {
  it('reopens the active document at its page and zoom with its edits', async () => {
    const repository = await repo();
    await seed(
      repository,
      record('a', { lastPage: 1, zoom: 1.5, fieldValues: { name: 'Jane' }, encrypted: false }),
    );
    await writeSetting(repository, 'activeDocumentId', 'a');
    await startSession(repository, { services: () => services(), controller: quiet });
    expect(useDocumentStore.getState()).toMatchObject({ status: 'ready', id: 'a', name: 'a.pdf' });
    expect(useViewStore.getState()).toMatchObject({ page: 1, zoom: 1.5 });
    expect(useEditsStore.getState().present.fieldValues).toEqual({ name: 'Jane' });
    // Starting again with the same repository does nothing.
    await startSession(repository, { services: () => services(), controller: quiet });
  });

  it('shows a notice, not a failure, when the bytes are gone', async () => {
    const repository = await repo();
    await seed(repository, record('a'), false);
    await writeSetting(repository, 'activeDocumentId', 'a');
    await startSession(repository, { services: () => services(), controller: quiet });
    expect(useDocumentStore.getState().status).toBe('empty');
    expect(useSessionStore.getState().notice).toBe('restore-missing');
    expect(useSessionStore.getState().recent).toEqual([]);
    expect(await repository.get('documents', 'a')).toBeUndefined();
    expect(await readSetting(repository, 'activeDocumentId')).toBeNull();
  });

  it('shows a notice when the record is gone', async () => {
    const repository = await repo();
    await writeSetting(repository, 'activeDocumentId', 'gone');
    await startSession(repository, { services: () => services(), controller: quiet });
    expect(useSessionStore.getState().notice).toBe('restore-missing');
  });

  it('asks for the password of an encrypted document again', async () => {
    const repository = await repo();
    await seed(repository, record('a', { encrypted: true, lastPage: 2 }));
    await writeSetting(repository, 'activeDocumentId', 'a');
    const askPassword = vi.fn(() => Promise.resolve('bogey'));
    await startSession(repository, {
      services: () =>
        services({
          bridge: encryptedBridge('bogey'),
          loader: fakeLoader({ password: 'bogey' }),
          askPassword,
        }),
      controller: quiet,
    });
    expect(askPassword).toHaveBeenCalledWith({ code: 'pdf.password-required' });
    expect(useDocumentStore.getState()).toMatchObject({ status: 'ready', password: 'bogey' });
    expect(useViewStore.getState().page).toBe(2);
    // The password is never stored, and neither is an image of page 1.
    await settle(repository);
    const saved = await repository.get('documents', 'a');
    expect(JSON.stringify(saved)).not.toContain('bogey');
    expect(saved!.thumbnail).toBeNull();
  });

  it('shows the recent list when the password is cancelled, and does not ask next time', async () => {
    const repository = await repo();
    await seed(repository, record('a', { encrypted: true }));
    await writeSetting(repository, 'activeDocumentId', 'a');
    await startSession(repository, {
      services: () =>
        services({ bridge: encryptedBridge('bogey'), loader: fakeLoader({ password: 'bogey' }) }),
      controller: quiet,
    });
    expect(useDocumentStore.getState().status).toBe('empty');
    expect(useSessionStore.getState().recent.map((r) => r.id)).toEqual(['a']);
    expect(await repository.get('documentBytes', 'a')).toBeDefined();
    expect(await readSetting(repository, 'activeDocumentId')).toBeNull();
  });

  it('leaves a document the user opened during start-up alone', async () => {
    const repository = await repo();
    await seed(repository, record('a'));
    await writeSetting(repository, 'activeDocumentId', 'a');
    useDocumentStore.getState().update({ status: 'opening' });
    await startSession(repository, { services: () => services(), controller: quiet });
    expect(useDocumentStore.getState().id).toBeNull();
  });
});

describe('opening and saving (D5, D6)', () => {
  it('saves a newly opened document and lists it', async () => {
    const repository = await repo();
    await startSession(repository, { services: () => services(), controller: quiet });
    await openDocument(pdfFile('w9.pdf'), services());
    await settle(repository);
    const { id } = useDocumentStore.getState();
    expect(await repository.get('documentBytes', id!)).toBeDefined();
    expect(await repository.get('documents', id!)).toMatchObject({ name: 'w9.pdf', pageCount: 3 });
    expect(await readSetting(repository, 'activeDocumentId')).toBe(id);
    expect(useSessionStore.getState().recent.map((r) => r.name)).toEqual(['w9.pdf']);
  });

  it('deletes what it saved when the password is cancelled', async () => {
    const repository = await repo();
    await startSession(repository, { services: () => services(), controller: quiet });
    await openDocument(
      pdfFile('locked.pdf'),
      services({ bridge: encryptedBridge('x'), loader: fakeLoader({ password: 'x' }) }),
    );
    await settle(repository);
    expect(await repository.getAll('documents')).toEqual([]);
    expect(await repository.getAll('documentBytes')).toEqual([]);
  });

  it('reopens and deletes from the recent list', async () => {
    const repository = await repo();
    await seed(repository, record('a', { lastPage: 2, overlays: [] }));
    await seed(repository, record('b', { updatedAt: NOW - 1000 }));
    await startSession(repository, { services: () => services(), controller: quiet });
    expect(useSessionStore.getState().recent.map((r) => r.id)).toEqual(['a', 'b']);

    await openSaved('a');
    expect(useDocumentStore.getState()).toMatchObject({ status: 'ready', id: 'a' });
    expect(useViewStore.getState().page).toBe(2);

    await deleteSaved('a');
    expect(useDocumentStore.getState().status).toBe('empty');
    await deleteSaved('b');
    expect(useSessionStore.getState().recent).toEqual([]);
    expect(await repository.getAll('documentBytes')).toEqual([]);
  });

  it('does nothing without a repository or a session', async () => {
    await openSaved('a');
    await deleteSaved('a');
    expect(await clearEverything(() => undefined)).toBe(false);
    await repo();
    await openSaved('a');
    expect(useDocumentStore.getState().status).toBe('empty');
  });

  it('keeps a failed reopen from claiming the record', async () => {
    const repository = await repo();
    await seed(repository, record('a'));
    await startSession(repository, {
      services: () => services({ loader: fakeLoader({ problem: { code: 'pdf.damaged' } }) }),
      controller: quiet,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openSaved('a');
    expect(useDocumentStore.getState().status).toBe('error');
  });
});

describe('pdf.js accepted the password, core rejected it (spec §9.6)', () => {
  it('opens for display and marks the document for page-image export', async () => {
    const repository = await repo();
    await startSession(repository, { services: () => services(), controller: quiet });
    const loader: FakeLoader = fakeLoader({ password: 'pw' });
    const rejecting: PdfBridge = {
      ...stubPdfBridge,
      inspect: (_bytes, password) =>
        Promise.resolve(
          fail({ code: password === undefined ? 'pdf.password-required' : 'pdf.password-wrong' }),
        ),
    };
    const askPassword = vi.fn(() => Promise.resolve('pw'));
    await openDocument(pdfFile('odd.pdf'), services({ bridge: rejecting, loader, askPassword }));
    expect(askPassword).toHaveBeenCalledOnce();
    expect(useDocumentStore.getState()).toMatchObject({
      status: 'ready',
      password: 'pw',
      info: { decryptable: false, encrypted: true, pageCount: 3, fields: [] },
    });
  });

  it('describes each page from its displayed size', async () => {
    const info = await pageImageInfo(
      fakeDocument(2, {
        sizes: [
          { width: 816, height: 1056 },
          { width: 1056, height: 816 },
        ],
      }),
    );
    expect(info.pages).toEqual([
      { index: 0, view: [0, 0, 612, 792], rotate: 0, userUnit: 1 },
      { index: 1, view: [0, 0, 792, 612], rotate: 0, userUnit: 1 },
    ]);
  });
});

describe('the record thumbnail', () => {
  it('renders page 1 at 200 px wide as PNG bytes', async () => {
    const display = fakeDocument(1);
    const canvas = document.createElement('canvas');
    canvas.toBlob = (callback) => callback(new Blob([new Uint8Array([137, 80])]));
    const png = await recordThumbnail(display, () => canvas);
    expect(new Uint8Array(png!)).toEqual(new Uint8Array([137, 80]));
    const page = await display.page(0);
    expect(page).toBeDefined();
    expect(canvas.width).toBe(0);
  });

  it('returns null when the browser cannot encode, or there is no page', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = () => {
      throw new Error('tainted');
    };
    expect(await recordThumbnail(fakeDocument(1), () => canvas)).toBeNull();
    canvas.toBlob = (callback) => callback(null);
    expect(await recordThumbnail(fakeDocument(1), () => canvas)).toBeNull();
    expect(await recordThumbnail(fakeDocument(0))).toBeNull();
  });
});

describe('Clear everything (S7)', () => {
  it('deletes the database and reloads only after the browser confirms', async () => {
    const repository = await repo();
    await seed(repository, record('a'));
    const reload = vi.fn();
    expect(await clearEverything(reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    const fresh = await openRepository({ factory: new IDBFactory() });
    expect(await fresh.getAll('documents')).toEqual([]);
  });

  it('stops saving and keeps the screen when deletion is not confirmed', async () => {
    const repository = await repo();
    vi.spyOn(repository, 'clearEverything').mockRejectedValue(new Error('blocked'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    expect(await clearEverything(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(useSessionStore.getState().saving).toBe(false);
  });

  it('asks once, then clears', async () => {
    await repo();
    const reload = vi.fn();
    render(<ClearEverything reload={reload} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear everything' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Clear everything?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Clear everything' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear everything' }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('tells the user to clear site data when the browser does not confirm', async () => {
    const repository = await repo();
    vi.spyOn(repository, 'clearEverything').mockRejectedValue(new Error('blocked'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <>
        <SettingsMenu />
        <StorageBanner />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear everything' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear everything' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Saved data may remain' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('site’s data');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alert')).toHaveTextContent('browser settings');
  });
});

describe('the recent list (D6)', () => {
  it('lists saved documents with page count, date and thumbnail; opens and deletes', async () => {
    const repository = await repo();
    await seed(repository, record('a', { thumbnail: new Uint8Array([1]).buffer }));
    await seed(repository, record('b', { pageCount: 1, updatedAt: NOW - 1 }));
    await seed(repository, record('c', { pageCount: 0, updatedAt: NOW - 2 }));
    await startSession(repository, { services: () => services(), controller: quiet });
    const { container, unmount } = render(<RecentDocuments />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('a.pdf3 pages, changed');
    expect(items[1]).toHaveTextContent('1 page, changed');
    expect(items[2]).not.toHaveTextContent('page');
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);

    await userEvent.click(screen.getByRole('button', { name: 'Delete c.pdf' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: /^b\.pdf/ }));
    await waitFor(() => expect(useDocumentStore.getState().id).toBe('b'));
    unmount();
  });

  it('shows a placeholder, not page 1, for a password-protected document', async () => {
    const repository = await repo();
    await seed(repository, record('locked', { encrypted: true }));
    await startSession(repository, { services: () => services(), controller: quiet });
    const { container } = render(<RecentDocuments />);
    expect(screen.getByRole('img', { name: 'Password-protected' })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('says what will appear when there is nothing saved', () => {
    render(<RecentDocuments />);
    expect(screen.getByText('Documents you open will be listed here.')).toBeInTheDocument();
  });
});

describe('storage notices', () => {
  it('shows and dismisses the session notices', async () => {
    render(<StorageBanner />);
    for (const [notice, text] of [
      ['restore-missing', 'no longer stored'],
      ['memory-only', 'Opened, but not saved on this device'],
      ['record-unreadable', 'could not be read'],
    ] as const) {
      act(() => useSessionStore.getState().setNotice(notice));
      expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByText(new RegExp(text))).not.toBeInTheDocument();
    }
  });

  it('shows the memory-mode banner (M3)', async () => {
    useStorageStore.getState().attach(await openRepository({ factory: null }));
    render(<StorageBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('not letting Bogey save');
  });

  it('shows the first-save notice with Clear everything until dismissed (spec §11.7)', async () => {
    const repository = await repo();
    render(<StorageBanner />);
    act(() => useSessionStore.getState().showFirstSaveNotice(true));
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('in this browser');
    expect(within(notice).getByRole('button', { name: 'Clear everything' })).toBeInTheDocument();
    await userEvent.click(within(notice).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await waitFor(async () =>
      expect(await readSetting(repository, 'firstRunNoticeDismissed')).toBe(true),
    );
  });
});
