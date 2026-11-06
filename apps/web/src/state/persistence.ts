// IndexedDB persistence (spec §10.5). One database, `bogey`, version 1, behind a small
// repository that serializes every operation through one queue (so a record never lands before
// the bytes it names), falls back to memory when IndexedDB is unavailable or fails (M3), and
// clears fail-closed: a clear is reported only when the browser confirmed the deletion (S7).
//
// Binary data is stored as ArrayBuffer, never Blob: WebKit intermittently aborts transactions
// holding Blobs ("Error preparing Blob/File data to be stored in object store"), as Safari has
// long done in private browsing, while ArrayBuffers store reliably in every engine (spec §10.5).
import type { DateFormat, FormType, Overlay, Snippet, XfaKind, FieldValues } from '@bogey/core';
import { wrap, type DBSchema, type IDBPDatabase } from 'idb';
import { TIMING } from '../config.ts';

export const DB_NAME = 'bogey';
export const DB_VERSION = 1;
export const RECORD_SCHEMA_VERSION = 1;

export type Zoom = number | 'fit-width' | 'fit-page';

export interface DocumentRecord {
  id: string;
  name: string;
  pageCount: number;
  formType: FormType;
  xfa: XfaKind;
  encrypted: boolean;
  /** PNG of page 1, about 200 px wide. */
  thumbnail: ArrayBuffer | null;
  createdAt: number;
  updatedAt: number;
  lastPage: number;
  zoom: Zoom;
  fieldValues: FieldValues;
  overlays: readonly Overlay[];
  schemaVersion: number;
}

export interface BytesRecord {
  id: string;
  /** The original PDF, exactly as opened. */
  bytes: ArrayBuffer;
  size: number;
  sha256: string;
}

export interface SignatureRecord {
  id: string;
  name: string;
  kind: 'signature' | 'initials';
  /** Transparent PNG. */
  png: ArrayBuffer;
  width: number;
  height: number;
  createdAt: number;
}

export interface SettingsValues {
  dateFormat: DateFormat;
  activeDocumentId: string | null;
  defaultFontSize: number;
  firstRunNoticeDismissed: boolean;
  persistRequested: boolean;
}

export interface SettingRecord<K extends keyof SettingsValues = keyof SettingsValues> {
  key: K;
  value: SettingsValues[K];
}

interface BogeySchema extends DBSchema {
  documents: { key: string; value: DocumentRecord };
  documentBytes: { key: string; value: BytesRecord };
  signatures: { key: string; value: SignatureRecord };
  snippets: { key: string; value: Snippet };
  settings: { key: string; value: SettingRecord };
}

export type StoreName = 'documents' | 'documentBytes' | 'signatures' | 'snippets' | 'settings';
export type RecordOf<S extends StoreName> = BogeySchema[S]['value'];
export const STORE_NAMES: readonly StoreName[] = [
  'documents',
  'documentBytes',
  'signatures',
  'snippets',
  'settings',
];
const KEY_PATHS: Record<StoreName, 'id' | 'key'> = {
  documents: 'id',
  documentBytes: 'id',
  signatures: 'id',
  snippets: 'id',
  settings: 'key',
};

export type StorageMode = 'persistent' | 'memory';
export type DegradeReason = 'unavailable' | 'full' | 'failed';

/** The storage operations the rest of the app uses; the same interface in both modes. */
export interface Repository {
  readonly mode: StorageMode;
  get<S extends StoreName>(store: S, key: string): Promise<RecordOf<S> | undefined>;
  getAll<S extends StoreName>(store: S): Promise<RecordOf<S>[]>;
  put<S extends StoreName>(store: S, value: RecordOf<S>): Promise<void>;
  /** Puts several records, across stores, in one transaction. */
  putMany(entries: readonly { store: StoreName; value: RecordOf<StoreName> }[]): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  deleteMany(entries: readonly { store: StoreName; key: string }[]): Promise<void>;
  /** Resolves once every queued operation has finished. */
  flush(): Promise<void>;
  /** Fail-closed removal of all saved data (spec §10.5, S7). Rejects if not confirmed. */
  clearEverything(): Promise<void>;
  /** Called once when the repository falls back to memory (M3). */
  onDegrade(listener: (reason: DegradeReason) => void): () => void;
}

export class ClearFailedError extends Error {
  constructor(cause?: unknown) {
    super('The browser did not confirm that saved data was removed.', { cause });
    this.name = 'ClearFailedError';
  }
}

/** An ordered queue: each operation starts after the previous one settles. */
function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const next = tail.then(operation, operation);
      tail = next.catch(() => undefined);
      return next;
    },
    idle: () => tail.then(() => undefined),
  };
}

const keyOf = (store: StoreName, value: RecordOf<StoreName>): string =>
  (value as unknown as Record<string, string>)[KEY_PATHS[store]]!;

/** In-memory storage with the repository's semantics, for M3 and for tests. */
class MemoryStores {
  readonly maps = new Map<StoreName, Map<string, unknown>>(
    STORE_NAMES.map((name) => [name, new Map()]),
  );
  get(store: StoreName, key: string) {
    return this.maps.get(store)!.get(key);
  }
  getAll(store: StoreName) {
    return [...this.maps.get(store)!.values()];
  }
  put(store: StoreName, value: RecordOf<StoreName>) {
    this.maps.get(store)!.set(keyOf(store, value), value);
  }
  delete(store: StoreName, key: string) {
    this.maps.get(store)!.delete(key);
  }
  clear() {
    for (const map of this.maps.values()) map.clear();
  }
}

export interface OpenOptions {
  /** Defaults to the global `indexedDB`; `null` forces memory mode. */
  factory?: IDBFactory | null;
  openTimeoutMs?: number;
  deleteTimeoutMs?: number;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

/** Opens the database, or returns a memory repository if IndexedDB is unusable (M3). */
export async function openRepository(options: OpenOptions = {}): Promise<Repository> {
  const factory = options.factory === undefined ? globalThis.indexedDB : options.factory;
  const openTimeoutMs = options.openTimeoutMs ?? TIMING.storageOpenTimeoutMs;
  const deleteTimeoutMs = options.deleteTimeoutMs ?? TIMING.deleteBlockedTimeoutMs;

  let db: IDBPDatabase<BogeySchema> | null = null;
  let degradeReason: DegradeReason | null = null;
  if (!factory) {
    degradeReason = 'unavailable';
  } else {
    db = await withTimeout(openDatabase(factory), openTimeoutMs).catch(() => null);
    if (!db) degradeReason = 'unavailable';
  }
  return new BogeyRepository(db, factory ?? null, degradeReason, deleteTimeoutMs);
}

/** Opens (and on first use creates) the database through the given factory. */
function openDatabase(factory: IDBFactory): Promise<IDBPDatabase<BogeySchema>> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of STORE_NAMES) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: KEY_PATHS[name] });
        }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      // Another tab wants to delete or upgrade the database: let it (spec §10.5).
      database.onversionchange = () => database.close();
      resolve(wrap(database) as unknown as IDBPDatabase<BogeySchema>);
    };
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onblocked = () => reject(new Error('open blocked'));
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

class BogeyRepository implements Repository {
  private readonly queue = serialQueue();
  private readonly memory = new MemoryStores();
  private readonly listeners = new Set<(reason: DegradeReason) => void>();

  constructor(
    private db: IDBPDatabase<BogeySchema> | null,
    private readonly factory: IDBFactory | null,
    private degradeReason: DegradeReason | null,
    private readonly deleteTimeoutMs: number,
  ) {}

  get mode(): StorageMode {
    return this.db ? 'persistent' : 'memory';
  }

  onDegrade(listener: (reason: DegradeReason) => void) {
    if (this.degradeReason) listener(this.degradeReason);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private degrade(reason: DegradeReason) {
    if (this.degradeReason) return;
    this.degradeReason = reason;
    this.db?.close();
    this.db = null;
    for (const listener of this.listeners) listener(reason);
  }

  /** Runs against IndexedDB, falling back to memory on failure; memory mirrors every write. */
  private run<T>(
    onDb: (db: IDBPDatabase<BogeySchema>) => Promise<T>,
    onMemory: () => T,
  ): Promise<T> {
    return this.queue.run(async () => {
      if (this.db) {
        try {
          return await onDb(this.db);
        } catch (error) {
          this.degrade(isQuotaError(error) ? 'full' : 'failed');
        }
      }
      return onMemory();
    });
  }

  get<S extends StoreName>(store: S, key: string) {
    return this.run(
      (db) => db.get(store, key) as Promise<RecordOf<S> | undefined>,
      () => this.memory.get(store, key) as RecordOf<S> | undefined,
    );
  }

  getAll<S extends StoreName>(store: S) {
    return this.run(
      (db) => db.getAll(store) as Promise<RecordOf<S>[]>,
      () => this.memory.getAll(store) as RecordOf<S>[],
    );
  }

  put<S extends StoreName>(store: S, value: RecordOf<S>) {
    return this.putMany([{ store, value }]);
  }

  putMany(entries: readonly { store: StoreName; value: RecordOf<StoreName> }[]) {
    return this.run(
      async (db) => {
        const stores = [...new Set(entries.map((entry) => entry.store))];
        const tx = db.transaction(stores, 'readwrite');
        // Each request's own rejection is reported through tx.done; don't leave it unhandled.
        for (const { store, value } of entries)
          tx.objectStore(store)
            .put(value as never)
            .catch(() => undefined);
        await tx.done;
        for (const { store, value } of entries) this.memory.put(store, value);
      },
      () => {
        for (const { store, value } of entries) this.memory.put(store, value);
      },
    );
  }

  delete(store: StoreName, key: string) {
    return this.deleteMany([{ store, key }]);
  }

  deleteMany(entries: readonly { store: StoreName; key: string }[]) {
    return this.run(
      async (db) => {
        const stores = [...new Set(entries.map((entry) => entry.store))];
        const tx = db.transaction(stores, 'readwrite');
        for (const { store, key } of entries)
          tx.objectStore(store)
            .delete(key)
            .catch(() => undefined);
        await tx.done;
        for (const { store, key } of entries) this.memory.delete(store, key);
      },
      () => {
        for (const { store, key } of entries) this.memory.delete(store, key);
      },
    );
  }

  flush() {
    return this.queue.idle();
  }

  clearEverything() {
    return this.queue.run(async () => {
      this.db?.close();
      this.db = null;
      // Only positive evidence that nothing is stored counts as nothing to remove (spec §10.5).
      if (this.factory) {
        try {
          await deleteDatabase(this.factory, this.deleteTimeoutMs);
        } catch (error) {
          throw new ClearFailedError(error);
        }
      }
      this.memory.clear();
    });
  }
}

/** Deletes the database; rejects on error or when still blocked after `timeoutMs`. */
function deleteDatabase(factory: IDBFactory, timeoutMs: number): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      // onblocked: other connections were asked to close; keep waiting until the timeout.
    }),
    timeoutMs,
  );
}
