// Documents kept in this browser (spec §10.5, D5–D7, M1, M3, M4). Owned by Sprint 6.
//
// - The open sequence writes a document's bytes once, before inspection (persistOpenedBytes).
// - The session controller watches the document, view and edits stores and rewrites the active
//   document's record (never its bytes) 500 ms after the last change, and at once when the page is
//   hidden or unloaded (M1).
// - The library is the list of saved records behind the recent list (D6): records are migrated
//   on load, expired after 30 days without edits, and capped at 20.
//
// Everything goes through the repository's ordered queue, so a record never lands before the bytes
// it names. Nothing here imports the open feature; features/storage/start.ts wires them together.
import type { DocumentEditState, PdfInfo } from '@bogey/core';
import { create } from 'zustand';
import { LIMITS, TIMING } from '../config.ts';
import { EMPTY_EDIT_STATE } from '../core-bridge/model.ts';
import type { PdfDisplayDocument } from '../pdfjs/types.ts';
import { useDocumentStore, type DocumentState } from './document.ts';
import { useEditsStore } from './edits.ts';
import {
  RECORD_SCHEMA_VERSION,
  type DocumentRecord,
  type Repository,
  type SettingsValues,
} from './persistence.ts';
import { useStorageStore } from './storage.ts';
import { useViewStore } from './view.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A notice about saved documents; the storage banner words it. */
export type SessionNotice =
  /** The document being restored or reopened is no longer stored (spec §10.5). */
  | 'restore-missing'
  /** Storage is nearly full, so the document opened without being saved (M3). */
  | 'memory-only'
  /** A saved record could not be read and was removed (migrations, spec §10.5). */
  | 'record-unreadable';

export interface SessionState {
  /** Saved documents, most recently updated first (D6). */
  recent: readonly DocumentRecord[];
  /** Ids whose bytes are stored in this browser; other documents live in memory only. */
  saved: ReadonlySet<string>;
  notice: SessionNotice | null;
  /** The first-save notice (spec §11.7) is showing. */
  firstSaveNotice: boolean;
  firstRunNoticeDismissed: boolean;
  persistRequested: boolean;
  /** False after a failed Clear everything: nothing more is written (spec §10.5). */
  saving: boolean;
}

export interface SessionActions {
  setRecent(recent: readonly DocumentRecord[]): void;
  upsertRecent(record: DocumentRecord): void;
  removeRecent(ids: readonly string[]): void;
  markSaved(id: string, saved: boolean): void;
  setNotice(notice: SessionNotice | null): void;
  showFirstSaveNotice(show: boolean): void;
  update(patch: Partial<SessionState>): void;
  reset(): void;
}

const initial: SessionState = {
  recent: [],
  saved: new Set(),
  notice: null,
  firstSaveNotice: false,
  firstRunNoticeDismissed: false,
  persistRequested: false,
  saving: true,
};

const byUpdated = (a: DocumentRecord, b: DocumentRecord) => b.updatedAt - a.updatedAt;

export const useSessionStore = create<SessionState & SessionActions>()((set) => ({
  ...initial,
  setRecent: (recent) => set({ recent: [...recent].sort(byUpdated) }),
  upsertRecent: (record) =>
    set((state) => ({
      recent: [...state.recent.filter((item) => item.id !== record.id), record].sort(byUpdated),
    })),
  removeRecent: (ids) =>
    set((state) => ({ recent: state.recent.filter((item) => !ids.includes(item.id)) })),
  markSaved: (id, saved) =>
    set((state) => {
      const next = new Set(state.saved);
      if (saved) next.add(id);
      else next.delete(id);
      return { saved: next };
    }),
  setNotice: (notice) => set({ notice }),
  showFirstSaveNotice: (firstSaveNotice) => set({ firstSaveNotice }),
  update: (patch) => set(patch),
  reset: () => set(initial),
}));

const session = () => useSessionStore.getState();
const sharedRepository = () => useStorageStore.getState().repository;

// ── records and migrations ──

/** Upgrades a record from the version in its key to the next one (spec §10.5). */
type Migration = (record: Record<string, unknown>) => Record<string, unknown>;

/**
 * The migration table: `MIGRATIONS[n]` turns a version n record into version n + 1. Version 1 is
 * the first schema, so the table is empty; a future change adds `1: (record) => ({ ... })` and
 * raises RECORD_SCHEMA_VERSION.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Realm-independent: IndexedDB may hand back an ArrayBuffer from another global. */
const isArrayBuffer = (value: unknown) =>
  Object.prototype.toString.call(value) === '[object ArrayBuffer]';

const isZoom = (value: unknown) =>
  value === 'fit-width' ||
  value === 'fit-page' ||
  (typeof value === 'number' && Number.isFinite(value) && value > 0);

/** The shape checks a stored record must pass before the app uses it. */
function isDocumentRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.pageCount === 'number' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.lastPage === 'number' &&
    typeof value.encrypted === 'boolean' &&
    (value.thumbnail === null || isArrayBuffer(value.thumbnail)) &&
    isZoom(value.zoom) &&
    isObject(value.fieldValues) &&
    Array.isArray(value.overlays)
  );
}

/**
 * Brings a stored record up to the current schema, or returns null if it cannot be read: an
 * unknown or future version, a missing migration, or a shape the app does not recognise.
 */
export function migrateRecord(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  current = RECORD_SCHEMA_VERSION,
): DocumentRecord | null {
  if (!isObject(raw) || typeof raw.schemaVersion !== 'number') return null;
  let record = raw;
  for (let version = raw.schemaVersion; version < current; version++) {
    const migrate = migrations[version];
    if (!migrate) return null;
    record = { ...migrate(record), schemaVersion: version + 1 };
  }
  if (record.schemaVersion !== current || !isDocumentRecord(record)) return null;
  return record as unknown as DocumentRecord;
}

/** True when the record has not been updated for the expiry period (spec §10.5). */
export const isExpired = (record: DocumentRecord, now: number) =>
  now - record.updatedAt > LIMITS.documentExpiryDays * DAY_MS;

/** The records to delete so at most `limit` remain: least recently updated first, never `keep`. */
export function evictionVictims(
  records: readonly DocumentRecord[],
  keep: string | null,
  limit: number = LIMITS.recentDocuments,
): DocumentRecord[] {
  const excess = records.length - limit;
  if (excess <= 0) return [];
  return records
    .filter((record) => record.id !== keep)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, excess);
}

const bothStores = (ids: readonly string[]) =>
  ids.flatMap((key) => [
    { store: 'documents' as const, key },
    { store: 'documentBytes' as const, key },
  ]);

/** Deletes documents, record and bytes together in one transaction. */
export async function deleteDocuments(repository: Repository, ids: readonly string[]) {
  if (ids.length === 0) return;
  await repository.deleteMany(bothStores(ids));
  session().removeRecent(ids);
  for (const id of ids) session().markSaved(id, false);
}

/**
 * Reads the library on load: unreadable records are deleted with a notice, and documents not
 * updated for 30 days are deleted (spec §10.5). Fills the recent list.
 */
export async function prepareLibrary(repository: Repository, now: number): Promise<void> {
  const stored = (await repository.getAll('documents')) as unknown[];
  const keep: DocumentRecord[] = [];
  const migrated: DocumentRecord[] = [];
  const remove: string[] = [];
  let unreadable = false;
  for (const raw of stored) {
    const record = migrateRecord(raw);
    if (!record) {
      unreadable = true;
      const id = isObject(raw) ? raw.id : undefined;
      if (typeof id === 'string') remove.push(id);
    } else if (isExpired(record, now)) {
      remove.push(record.id);
    } else {
      keep.push(record);
      if ((raw as { schemaVersion: number }).schemaVersion !== record.schemaVersion) {
        migrated.push(record);
      }
    }
  }
  if (remove.length > 0) await repository.deleteMany(bothStores(remove));
  if (migrated.length > 0) {
    await repository.putMany(migrated.map((value) => ({ store: 'documents' as const, value })));
  }
  session().setRecent(keep);
  if (unreadable) session().setNotice('record-unreadable');
}

// ── settings ──

export async function readSetting<K extends keyof SettingsValues>(
  repository: Repository,
  key: K,
): Promise<SettingsValues[K] | undefined> {
  const record = await repository.get('settings', key);
  return record?.value as SettingsValues[K] | undefined;
}

export function writeSetting<K extends keyof SettingsValues>(
  repository: Repository,
  key: K,
  value: SettingsValues[K],
): Promise<void> {
  return repository.put('settings', { key, value } as never);
}

/** Reads the settings this module uses into the session store. */
export async function loadSessionSettings(repository: Repository): Promise<string | null> {
  const [dismissed, requested, activeId] = await Promise.all([
    readSetting(repository, 'firstRunNoticeDismissed'),
    readSetting(repository, 'persistRequested'),
    readSetting(repository, 'activeDocumentId'),
  ]);
  session().update({
    firstRunNoticeDismissed: dismissed === true,
    persistRequested: requested === true,
  });
  return typeof activeId === 'string' ? activeId : null;
}

/** Hides the first-save notice for good (spec §11.7). */
export async function dismissFirstSaveNotice(): Promise<void> {
  session().update({ firstSaveNotice: false, firstRunNoticeDismissed: true });
  const repository = sharedRepository();
  if (repository && session().saving) {
    await writeSetting(repository, 'firstRunNoticeDismissed', true);
  }
}

// ── bytes, at open (D5) ──

export interface StorageEstimateLike {
  usage?: number;
  quota?: number;
}

export interface PersistDeps {
  estimate(): Promise<StorageEstimateLike | null>;
  digest(bytes: Uint8Array): Promise<string>;
  now(): number;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
  const hash = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const browserPersistDeps: PersistDeps = {
  estimate: async () => {
    const storage = globalThis.navigator?.storage;
    if (typeof storage?.estimate !== 'function') return null;
    return storage.estimate().catch(() => null);
  },
  digest: sha256,
  now: () => Date.now(),
};

/** True when storing `size` more bytes stays within the share of quota the app allows (M3). */
export function withinBudget(estimate: StorageEstimateLike | null, size: number): boolean {
  if (!estimate?.quota) return true;
  return (estimate.usage ?? 0) + size <= estimate.quota * LIMITS.storageQuotaShare;
}

/** A record for bytes whose document has not been inspected yet. */
export function provisionalRecord(id: string, name: string, now: number): DocumentRecord {
  return {
    id,
    name,
    pageCount: 0,
    formType: 'flat',
    xfa: 'none',
    encrypted: false,
    thumbnail: null,
    createdAt: now,
    updatedAt: now,
    lastPage: 0,
    zoom: 'fit-width',
    fieldValues: {},
    overlays: [],
    schemaVersion: RECORD_SCHEMA_VERSION,
  };
}

/** The bytes as an ArrayBuffer of their own (spec §10.5: never a Blob). */
const ownBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);

/**
 * Writes a just-opened document's bytes with a provisional record, before inspection (spec §6.1
 * step 3), so a crash while parsing still leaves the file in the recent list. Over the storage
 * budget the document stays in memory with a notice (M3). Returns whether it was saved.
 */
export async function persistOpenedBytes(
  id: string,
  name: string,
  bytes: Uint8Array,
  deps: PersistDeps = browserPersistDeps,
): Promise<boolean> {
  const repository = sharedRepository();
  if (!repository || repository.mode !== 'persistent' || !session().saving) return false;
  if (!withinBudget(await deps.estimate(), bytes.byteLength)) {
    session().setNotice('memory-only');
    return false;
  }
  const record = provisionalRecord(id, name, deps.now());
  await repository.putMany([
    {
      store: 'documentBytes',
      value: {
        id,
        bytes: ownBuffer(bytes),
        size: bytes.byteLength,
        sha256: await deps.digest(bytes),
      },
    },
    { store: 'documents', value: record },
  ]);
  // A QuotaExceededError switches the repository to memory (M3); the banner says so.
  const saved = repository.mode === 'persistent';
  session().markSaved(id, saved);
  return saved;
}

/** Undoes persistOpenedBytes when the open is cancelled or fails. */
export async function forgetOpenedBytes(id: string): Promise<void> {
  const repository = sharedRepository();
  if (!repository) return;
  await deleteDocuments(repository, [id]);
}

// ── the session controller (M1, D7) ──

export interface SessionControllerOptions {
  repository: Repository;
  /** Renders page 1 for the recent list; null if it cannot. */
  makeThumbnail?(display: PdfDisplayDocument): Promise<ArrayBuffer | null>;
  /** `navigator.storage.persist()` (M4). */
  requestPersistence?(): Promise<boolean>;
  /** Receives `visibilitychange`; its `visibilityState` is read. */
  document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  /** Receives `pagehide`. */
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now?(): number;
  debounceMs?: number;
}

export interface SessionController {
  start(): void;
  stop(): void;
  /** The next document to become ready with this id reopens with this record's state (D7). */
  expect(record: DocumentRecord): void;
  forget(id: string): void;
  /** Writes the active record now if a write is pending. */
  flush(): Promise<void>;
}

export function createSessionController(options: SessionControllerOptions): SessionController {
  const { repository } = options;
  const now = options.now ?? (() => Date.now());
  const debounceMs = options.debounceMs ?? TIMING.autosaveMs;
  const expected = new Map<string, DocumentRecord>();
  let record: DocumentRecord | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let applying = false;
  let unsubscribers: (() => void)[] = [];
  let writing: Promise<void> = Promise.resolve();

  const canSave = (id: string) => session().saving && session().saved.has(id);

  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** The active record with the stores' current page, zoom and edits. */
  const snapshot = (base: DocumentRecord): DocumentRecord => {
    const { page, zoom } = useViewStore.getState();
    const { present } = useEditsStore.getState();
    return {
      ...base,
      lastPage: page,
      zoom,
      fieldValues: present.fieldValues,
      overlays: present.overlays,
      updatedAt: now(),
    };
  };

  const write = (): Promise<void> => {
    cancelTimer();
    if (!record || !canSave(record.id)) return writing;
    record = snapshot(record);
    const value = record;
    session().upsertRecent(value);
    writing = repository
      .put('documents', value)
      .catch((error: unknown) => console.error('The document could not be saved', error));
    return writing;
  };

  const schedule = () => {
    if (applying || !record || !canSave(record.id)) return;
    cancelTimer();
    timer = setTimeout(() => void write(), debounceMs);
  };

  const setActive = (id: string | null) =>
    session().saving
      ? writeSetting(repository, 'activeDocumentId', id).catch((error: unknown) =>
          console.error('The active document could not be recorded', error),
        )
      : Promise.resolve();

  const firstSave = async () => {
    const state = session();
    if (!state.firstRunNoticeDismissed) state.showFirstSaveNotice(true);
    if (state.persistRequested || !options.requestPersistence) return;
    state.update({ persistRequested: true });
    await writeSetting(repository, 'persistRequested', true);
    await options.requestPersistence().catch(() => false);
  };

  const evict = async (keep: string) => {
    const victims = evictionVictims(session().recent, keep);
    await deleteDocuments(
      repository,
      victims.map((victim) => victim.id),
    );
  };

  const addThumbnail = async (id: string, display: PdfDisplayDocument) => {
    const thumbnail = await options.makeThumbnail!(display).catch(() => null);
    if (!thumbnail || record?.id !== id) return;
    record = { ...record, thumbnail };
    await write();
  };

  const opened = (state: DocumentState) => {
    const id = state.id!;
    const info = state.info as PdfInfo;
    const saved = expected.get(id);
    expected.delete(id);
    const restored: DocumentEditState = saved
      ? { fieldValues: saved.fieldValues, overlays: saved.overlays }
      : EMPTY_EDIT_STATE;
    applying = true;
    try {
      if (saved) {
        const lastPage = Math.min(Math.max(0, saved.lastPage), Math.max(0, info.pageCount - 1));
        useViewStore.getState().setPage(lastPage);
        useViewStore.getState().setZoom(saved.zoom);
      }
      useEditsStore.getState().load(restored, info);
    } finally {
      applying = false;
    }
    const base = saved ?? provisionalRecord(id, state.name ?? 'document.pdf', now());
    record = {
      ...base,
      name: state.name ?? base.name,
      pageCount: info.pageCount,
      formType: info.formType,
      xfa: info.xfa,
      encrypted: info.encrypted,
    };
    if (!canSave(id)) {
      void setActive(null);
      return;
    }
    void (async () => {
      await write();
      await setActive(id);
      await evict(id);
      await firstSave();
      if (!record?.thumbnail && options.makeThumbnail && state.display) {
        await addThumbnail(id, state.display);
      }
    })().catch((error: unknown) => console.error('Saving the opened document failed', error));
  };

  const closed = () => {
    if (record && timer !== null) void write();
    cancelTimer();
    record = null;
    void setActive(null);
  };

  const onDocument = (state: DocumentState, previous: DocumentState) => {
    if (state.status === 'ready' && state.id && state.id !== record?.id) {
      if (previous.status === 'ready' && record) closed();
      opened(state);
    } else if (previous.status === 'ready' && state.status !== 'ready' && record) {
      closed();
    }
  };

  const onHidden = () => {
    if (options.document?.visibilityState === 'hidden') void flushNow();
  };
  const flushNow = () => (timer !== null ? write() : writing);

  return {
    start() {
      if (unsubscribers.length > 0) return;
      unsubscribers = [
        useDocumentStore.subscribe(onDocument),
        useViewStore.subscribe((state, previous) => {
          if (state.page !== previous.page || state.zoom !== previous.zoom) schedule();
        }),
        useEditsStore.subscribe((state, previous) => {
          if (state.present !== previous.present) schedule();
        }),
      ];
      const doc = options.document;
      const win = options.window;
      doc?.addEventListener('visibilitychange', onHidden);
      win?.addEventListener('pagehide', flushNow);
      unsubscribers.push(() => {
        doc?.removeEventListener('visibilitychange', onHidden);
        win?.removeEventListener('pagehide', flushNow);
      });
    },
    stop() {
      cancelTimer();
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers = [];
      record = null;
    },
    expect(saved) {
      expected.set(saved.id, saved);
    },
    forget(id) {
      expected.delete(id);
    },
    flush: flushNow,
  };
}
