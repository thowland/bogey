// The session controller and library (Sprint 6: D5–D7, M1, M3, M4) on fake-indexeddb.
import 'fake-indexeddb/auto';
import type { Overlay, PdfInfo } from '@bogey/core';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/config.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import {
  openRepository,
  RECORD_SCHEMA_VERSION,
  type DocumentRecord,
  type Repository,
} from '../src/state/persistence.ts';
import {
  createSessionController,
  dismissFirstSaveNotice,
  evictionVictims,
  forgetOpenedBytes,
  isExpired,
  loadSessionSettings,
  MIGRATIONS,
  migrateRecord,
  persistOpenedBytes,
  prepareLibrary,
  provisionalRecord,
  readSetting,
  useSessionStore,
  withinBudget,
  writeSetting,
  type PersistDeps,
  type SessionController,
} from '../src/state/session.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { useViewStore } from '../src/state/view.ts';
import { fakeDocument } from './fakePdfjs.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const record = (id: string, patch: Partial<DocumentRecord> = {}): DocumentRecord => ({
  ...provisionalRecord(id, `${id}.pdf`, NOW),
  pageCount: 3,
  ...patch,
});

const info = (pageCount = 3): PdfInfo => ({
  formType: 'flat',
  xfa: 'none',
  encrypted: false,
  decryptable: true,
  pageCount,
  pages: [],
  fields: [],
  initialValues: {},
  metadata: {},
});

const overlay: Overlay = {
  id: 'o1',
  type: 'text',
  page: 0,
  x: 72,
  y: 700,
  text: 'Jane Doe',
  fontSize: 12,
} as unknown as Overlay;

const deps = (patch: Partial<PersistDeps> = {}): PersistDeps => ({
  estimate: () => Promise.resolve({ usage: 0, quota: 1_000_000 }),
  digest: () => Promise.resolve('hash'),
  now: () => NOW,
  ...patch,
});

async function attach(): Promise<Repository> {
  const repository = await openRepository({ factory: new IDBFactory() });
  useStorageStore.getState().attach(repository);
  return repository;
}

/** Makes the document store show `id` as open and ready, as openDocument does. */
function ready(id: string, pageCount = 3, name = `${id}.pdf`) {
  useViewStore.getState().setPage(0);
  useDocumentStore.getState().update({
    status: 'ready',
    id,
    name,
    info: info(pageCount),
    display: fakeDocument(pageCount),
    bytes: new Uint8Array([37]),
  });
}

/** Lets queued repository work and promise chains settle. */
const settle = async (repository: Repository) => {
  for (let i = 0; i < 5; i++) {
    await repository.flush();
    await new Promise((resolve) => setImmediate(resolve));
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useSessionStore.getState().reset();
});

describe('records and migrations (spec §10.5)', () => {
  it('accepts a current record and rejects unreadable ones', () => {
    expect(migrateRecord(record('a'))).toMatchObject({ id: 'a' });
    expect(migrateRecord(null)).toBeNull();
    expect(migrateRecord({ id: 'a' })).toBeNull();
    expect(migrateRecord({ ...record('a'), schemaVersion: RECORD_SCHEMA_VERSION + 1 })).toBeNull();
    expect(migrateRecord({ ...record('a'), zoom: -1 })).toBeNull();
    expect(migrateRecord({ ...record('a'), overlays: 'none' })).toBeNull();
    expect(migrateRecord({ ...record('a'), thumbnail: 'png' })).toBeNull();
    expect(migrateRecord({ ...record('a'), zoom: 1.5 })).toMatchObject({ zoom: 1.5 });
  });

  it('runs the migration table in order up to the current version', () => {
    const old = { ...record('a'), schemaVersion: 1, title: 'x' };
    const migrations = {
      1: (r: Record<string, unknown>) => ({ ...r, name: `${String(r.name)}!` }),
      2: (r: Record<string, unknown>) => ({ ...r, lastPage: 2 }),
    };
    expect(migrateRecord(old, migrations, 3)).toMatchObject({
      name: 'a.pdf!',
      lastPage: 2,
      schemaVersion: 3,
    });
    // A version with no migration cannot be read.
    expect(migrateRecord(old, { 1: migrations[1] }, 3)).toBeNull();
  });

  it('expires records after 30 days without edits', () => {
    const limit = LIMITS.documentExpiryDays * DAY;
    expect(isExpired(record('a', { updatedAt: NOW - limit }), NOW)).toBe(false);
    expect(isExpired(record('a', { updatedAt: NOW - limit - 1 }), NOW)).toBe(true);
  });

  it('evicts the least recently updated documents, never the active one', () => {
    const records = Array.from({ length: 22 }, (_, i) => record(`d${i}`, { updatedAt: i }));
    expect(evictionVictims(records.slice(0, 20), null)).toEqual([]);
    expect(evictionVictims(records, null).map((r) => r.id)).toEqual(['d0', 'd1']);
    expect(evictionVictims(records, 'd0').map((r) => r.id)).toEqual(['d1', 'd2']);
  });

  it('prepares the library: removes unreadable and expired records, migrates the rest', async () => {
    const repository = await attach();
    const bytes = (id: string) => ({
      store: 'documentBytes' as const,
      value: { id, bytes: new ArrayBuffer(1), size: 1, sha256: '' },
    });
    await repository.putMany([
      { store: 'documents', value: record('fresh', { updatedAt: NOW - DAY }) },
      bytes('fresh'),
      { store: 'documents', value: record('old', { updatedAt: NOW - 31 * DAY }) },
      bytes('old'),
      { store: 'documents', value: { id: 'broken', schemaVersion: 1 } as never },
      bytes('broken'),
    ]);
    await prepareLibrary(repository, NOW);
    expect(useSessionStore.getState().recent.map((r) => r.id)).toEqual(['fresh']);
    expect(useSessionStore.getState().notice).toBe('record-unreadable');
    expect(await repository.get('documents', 'old')).toBeUndefined();
    expect(await repository.get('documentBytes', 'old')).toBeUndefined();
    expect(await repository.get('documentBytes', 'broken')).toBeUndefined();
    expect(await repository.get('documentBytes', 'fresh')).toBeDefined();
  });

  it('rewrites records that a migration upgraded', async () => {
    const repository = await attach();
    const table = MIGRATIONS as Record<
      number,
      (r: Record<string, unknown>) => Record<string, unknown>
    >;
    table[0] = (r) => ({ ...r, name: 'upgraded.pdf' });
    try {
      await repository.put('documents', { ...record('a'), schemaVersion: 0 } as DocumentRecord);
      await prepareLibrary(repository, NOW);
      expect(useSessionStore.getState().recent).toMatchObject([{ id: 'a', name: 'upgraded.pdf' }]);
      expect(await repository.get('documents', 'a')).toMatchObject({
        name: 'upgraded.pdf',
        schemaVersion: RECORD_SCHEMA_VERSION,
      });
    } finally {
      delete table[0];
    }
  });
});

describe('settings', () => {
  it('reads and writes the session settings', async () => {
    const repository = await attach();
    expect(await loadSessionSettings(repository)).toBeNull();
    await writeSetting(repository, 'activeDocumentId', 'a');
    await writeSetting(repository, 'persistRequested', true);
    expect(await loadSessionSettings(repository)).toBe('a');
    expect(useSessionStore.getState()).toMatchObject({
      persistRequested: true,
      firstRunNoticeDismissed: false,
    });
    useSessionStore.getState().showFirstSaveNotice(true);
    await dismissFirstSaveNotice();
    expect(useSessionStore.getState().firstSaveNotice).toBe(false);
    expect(await readSetting(repository, 'firstRunNoticeDismissed')).toBe(true);
  });
});

describe('saving bytes at open (D5, M3)', () => {
  it('writes the bytes and a provisional record in one transaction, before inspection', async () => {
    const repository = await attach();
    const bytes = new Uint8Array([37, 80, 68, 70]);
    expect(await persistOpenedBytes('a', 'a.pdf', bytes, deps())).toBe(true);
    const stored = await repository.get('documentBytes', 'a');
    expect(stored).toMatchObject({ id: 'a', size: 4, sha256: 'hash' });
    expect(Object.prototype.toString.call(stored!.bytes)).toBe('[object ArrayBuffer]');
    expect(new Uint8Array(stored!.bytes)).toEqual(bytes);
    expect(await repository.get('documents', 'a')).toMatchObject({ name: 'a.pdf', pageCount: 0 });
    expect(useSessionStore.getState().saved.has('a')).toBe(true);

    await forgetOpenedBytes('a');
    expect(await repository.get('documentBytes', 'a')).toBeUndefined();
    expect(await repository.get('documents', 'a')).toBeUndefined();
    expect(useSessionStore.getState().saved.has('a')).toBe(false);
  });

  it('computes a SHA-256 with the default dependencies', async () => {
    const repository = await attach();
    const { browserPersistDeps } = await import('../src/state/session.ts');
    const buffer = new Uint8Array([0, 97, 98, 99, 0]);
    await persistOpenedBytes('a', 'a.pdf', buffer.subarray(1, 4), browserPersistDeps);
    const stored = await repository.get('documentBytes', 'a');
    expect(new Uint8Array(stored!.bytes)).toEqual(new Uint8Array([97, 98, 99]));
    expect(stored!.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('skips saving without a persistent repository or after a failed clear', async () => {
    const bytes = new Uint8Array([37]);
    expect(await persistOpenedBytes('a', 'a.pdf', bytes, deps())).toBe(false);
    useStorageStore.getState().attach(await openRepository({ factory: null }));
    expect(await persistOpenedBytes('a', 'a.pdf', bytes, deps())).toBe(false);
    await attach();
    useSessionStore.getState().update({ saving: false });
    expect(await persistOpenedBytes('a', 'a.pdf', bytes, deps())).toBe(false);
    await forgetOpenedBytes('a');
  });

  it('opens in memory only, with a notice, above 80% of quota', async () => {
    const repository = await attach();
    expect(withinBudget(null, 10)).toBe(true);
    expect(withinBudget({ quota: 0 }, 10)).toBe(true);
    expect(withinBudget({ quota: 100 }, 80)).toBe(true);
    expect(withinBudget({ usage: 71, quota: 100 }, 10)).toBe(false);
    const estimate = () => Promise.resolve({ usage: 790, quota: 1000 });
    expect(await persistOpenedBytes('a', 'a.pdf', new Uint8Array(20), deps({ estimate }))).toBe(
      false,
    );
    expect(useSessionStore.getState().notice).toBe('memory-only');
    expect(await repository.get('documentBytes', 'a')).toBeUndefined();
  });

  it('switches to memory mode on QuotaExceededError (M3)', async () => {
    const repository = await attach();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(await persistOpenedBytes('a', 'a.pdf', new Uint8Array([37]), deps())).toBe(false);
    expect(repository.mode).toBe('memory');
    expect(useStorageStore.getState()).toMatchObject({ mode: 'memory', degradeReason: 'full' });
    expect(useSessionStore.getState().saved.has('a')).toBe(false);
  });
});

describe('the session controller (M1, D7)', () => {
  let repository: Repository;
  let controller: SessionController;
  let doc: EventTarget & { visibilityState: DocumentVisibilityState };
  let win: EventTarget;
  let clock: number;
  const makeThumbnail = vi.fn(() => Promise.resolve(new Uint8Array([9]).buffer as ArrayBuffer));
  const requestPersistence = vi.fn(() => Promise.resolve(true));

  beforeEach(async () => {
    repository = await attach();
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as const });
    win = new EventTarget();
    clock = NOW;
    makeThumbnail.mockClear();
    requestPersistence.mockClear();
    controller = createSessionController({
      repository,
      makeThumbnail,
      requestPersistence,
      document: doc as never,
      window: win as never,
      now: () => clock,
    });
    controller.start();
  });

  afterEach(() => controller.stop());

  /** Saves bytes for `id` as the persist step would, then marks it open. */
  async function open(id: string, pageCount = 3) {
    await persistOpenedBytes(id, `${id}.pdf`, new Uint8Array([37]), deps({ now: () => clock }));
    ready(id, pageCount);
    await settle(repository);
  }

  it('writes the full record, the active id and a thumbnail when a saved document opens', async () => {
    await open('a');
    expect(await repository.get('documents', 'a')).toMatchObject({
      pageCount: 3,
      formType: 'flat',
      thumbnail: expect.anything(),
    });
    expect(await readSetting(repository, 'activeDocumentId')).toBe('a');
    expect(useSessionStore.getState().recent.map((r) => r.id)).toEqual(['a']);
    expect(makeThumbnail).toHaveBeenCalledOnce();
  });

  it('shows the first-save notice and asks for persistent storage once (M4, spec §11.7)', async () => {
    await open('a');
    expect(useSessionStore.getState().firstSaveNotice).toBe(true);
    expect(requestPersistence).toHaveBeenCalledOnce();
    expect(await readSetting(repository, 'persistRequested')).toBe(true);
    await open('b');
    expect(requestPersistence).toHaveBeenCalledOnce();

    await dismissFirstSaveNotice();
    await open('c');
    expect(useSessionStore.getState().firstSaveNotice).toBe(false);
  });

  it('debounces writes 500 ms after the last change', async () => {
    await open('a');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const put = vi.spyOn(repository, 'put');
    clock += 1000;
    useViewStore.getState().setPage(1);
    vi.advanceTimersByTime(300);
    useViewStore.getState().setZoom(1.5);
    useEditsStore.getState().load({ fieldValues: { name: 'Jane' }, overlays: [overlay] });
    vi.advanceTimersByTime(499);
    expect(put).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(put).toHaveBeenCalledOnce();
    vi.useRealTimers();
    await settle(repository);
    expect(await repository.get('documents', 'a')).toMatchObject({
      lastPage: 1,
      zoom: 1.5,
      fieldValues: { name: 'Jane' },
      overlays: [{ id: 'o1' }],
      updatedAt: NOW + 1000,
    });
  });

  it('writes at once when the page is hidden or unloaded', async () => {
    await open('a');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const put = vi.spyOn(repository, 'put');
    useViewStore.getState().setPage(2);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(put).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(put).toHaveBeenCalledOnce();
    // Nothing pending: no second write.
    win.dispatchEvent(new Event('pagehide'));
    expect(put).toHaveBeenCalledOnce();
    useViewStore.getState().setZoom('fit-page');
    win.dispatchEvent(new Event('pagehide'));
    expect(put).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(put).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    await settle(repository);
    expect(await repository.get('documents', 'a')).toMatchObject({ lastPage: 2, zoom: 'fit-page' });
  });

  it('keeps bytes ahead of the record in the queue', async () => {
    const order: string[] = [];
    const putMany = repository.putMany.bind(repository);
    vi.spyOn(repository, 'putMany').mockImplementation((entries) => {
      order.push(entries.map((entry) => entry.store).join('+'));
      return putMany(entries);
    });
    // Not awaited: the record write is queued behind the bytes.
    const saving = persistOpenedBytes('a', 'a.pdf', new Uint8Array([37]), deps());
    await saving;
    ready('a');
    await settle(repository);
    expect(order[0]).toBe('documentBytes+documents');
    expect(order.slice(1)).toContain('documents');
  });

  it('reopens an expected record at its page and zoom with its edits (D7)', async () => {
    const saved = record('a', {
      lastPage: 2,
      zoom: 2,
      fieldValues: { name: 'Jane' },
      overlays: [overlay],
      createdAt: NOW - DAY,
    });
    await repository.put('documents', saved);
    useSessionStore.getState().markSaved('a', true);
    controller.expect(saved);
    ready('a');
    expect(useViewStore.getState()).toMatchObject({ page: 2, zoom: 2 });
    expect(useEditsStore.getState().present).toEqual({
      fieldValues: { name: 'Jane' },
      overlays: [overlay],
    });
    await settle(repository);
    expect(await repository.get('documents', 'a')).toMatchObject({ createdAt: NOW - DAY });
  });

  it('clamps a saved page beyond the document', async () => {
    const saved = record('a', { lastPage: 9 });
    useSessionStore.getState().markSaved('a', true);
    controller.expect(saved);
    ready('a', 2);
    expect(useViewStore.getState().page).toBe(1);
    controller.forget('a');
  });

  it('starts a new document with no edits', async () => {
    useEditsStore.getState().load({ fieldValues: { old: 'x' }, overlays: [] });
    await open('a');
    expect(useEditsStore.getState().present).toEqual({ fieldValues: {}, overlays: [] });
  });

  it('does not save a memory-only document, and clears the active id', async () => {
    await writeSetting(repository, 'activeDocumentId', 'old');
    ready('m');
    await settle(repository);
    expect(await repository.get('documents', 'm')).toBeUndefined();
    expect(await readSetting(repository, 'activeDocumentId')).toBeNull();
    const put = vi.spyOn(repository, 'put');
    useViewStore.getState().setPage(1);
    win.dispatchEvent(new Event('pagehide'));
    expect(put).not.toHaveBeenCalled();
  });

  it('flushes a pending write and clears the active id when the document closes', async () => {
    await open('a');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useViewStore.getState().setPage(2);
    useDocumentStore.getState().reset();
    vi.useRealTimers();
    await settle(repository);
    expect(await repository.get('documents', 'a')).toMatchObject({ lastPage: 2 });
    expect(await readSetting(repository, 'activeDocumentId')).toBeNull();
  });

  it('switches records when another document opens directly', async () => {
    await open('a');
    await persistOpenedBytes('b', 'b.pdf', new Uint8Array([37]), deps());
    ready('b');
    await settle(repository);
    expect(await readSetting(repository, 'activeDocumentId')).toBe('b');
  });

  it('evicts the least recently updated document when a 21st is saved (D6)', async () => {
    for (let i = 0; i < LIMITS.recentDocuments; i++) {
      clock = NOW + i;
      await open(`d${i}`);
    }
    expect(useSessionStore.getState().recent).toHaveLength(20);
    clock = NOW + 100;
    await open('d20');
    const ids = useSessionStore.getState().recent.map((r) => r.id);
    expect(ids).toHaveLength(20);
    expect(ids).not.toContain('d0');
    expect(ids[0]).toBe('d20');
    expect(await repository.get('documents', 'd0')).toBeUndefined();
    expect(await repository.get('documentBytes', 'd0')).toBeUndefined();
    expect((await repository.getAll('documents')).length).toBe(20);
  });

  it('stops writing once stopped or once saving is switched off', async () => {
    await open('a');
    const put = vi.spyOn(repository, 'put');
    useSessionStore.getState().update({ saving: false });
    useViewStore.getState().setPage(1);
    win.dispatchEvent(new Event('pagehide'));
    expect(put).not.toHaveBeenCalled();
    useSessionStore.getState().update({ saving: true });
    controller.stop();
    useViewStore.getState().setPage(2);
    win.dispatchEvent(new Event('pagehide'));
    expect(put).not.toHaveBeenCalled();
    controller.start();
    controller.start();
  });

  it('ignores a thumbnail that fails or arrives after the document closed', async () => {
    makeThumbnail.mockImplementationOnce(() => Promise.reject(new Error('no canvas')));
    await open('a');
    expect((await repository.get('documents', 'a'))!.thumbnail).toBeNull();
    let finish!: (value: ArrayBuffer) => void;
    makeThumbnail.mockImplementationOnce(
      () => new Promise<ArrayBuffer>((resolve) => (finish = resolve)),
    );
    await open('b');
    useDocumentStore.getState().reset();
    await settle(repository);
    finish(new ArrayBuffer(1));
    await settle(repository);
    expect((await repository.get('documents', 'b'))!.thumbnail).toBeNull();
  });

  it('logs a failed write instead of throwing', async () => {
    await open('a');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(repository, 'put').mockRejectedValue(new Error('disk'));
    useViewStore.getState().setPage(1);
    await controller.flush();
    win.dispatchEvent(new Event('pagehide'));
    await settle(repository);
    expect(error).toHaveBeenCalled();
  });
});
