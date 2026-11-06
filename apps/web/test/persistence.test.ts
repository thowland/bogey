import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClearFailedError,
  DB_NAME,
  openRepository,
  type DocumentRecord,
  type SignatureRecord,
} from '../src/state/persistence.ts';
import { startup } from '../src/startup.ts';
import { useStorageStore } from '../src/state/storage.ts';

const signature = (id: string): SignatureRecord => ({
  id,
  name: 'Signature',
  kind: 'signature',
  png: new Uint8Array([1, 2]).buffer,
  width: 10,
  height: 5,
  createdAt: 1,
});

const documentRecord = (id: string): DocumentRecord => ({
  id,
  name: 'w9.pdf',
  pageCount: 6,
  formType: 'acroform',
  xfa: 'none',
  encrypted: false,
  thumbnail: null,
  createdAt: 1,
  updatedAt: 2,
  lastPage: 0,
  zoom: 'fit-width',
  fieldValues: {},
  overlays: [],
  schemaVersion: 1,
});

afterEach(() => vi.restoreAllMocks());

describe('repository on IndexedDB', () => {
  it('creates every store and round-trips records in order', async () => {
    const repo = await openRepository({ factory: new IDBFactory() });
    expect(repo.mode).toBe('persistent');
    // Not awaited: the queue keeps the read after the write.
    void repo.put('signatures', signature('a'));
    expect(await repo.get('signatures', 'a')).toMatchObject({ id: 'a' });
    await repo.putMany([
      { store: 'documents', value: documentRecord('d') },
      {
        store: 'documentBytes',
        value: { id: 'd', bytes: new Uint8Array([37]).buffer, size: 4, sha256: 'x' },
      },
      { store: 'settings', value: { key: 'dateFormat', value: 'YYYY-MM-DD' } },
      { store: 'snippets', value: { id: 'n', label: 'Phone', value: '555', order: 0 } },
    ]);
    expect(await repo.getAll('documents')).toHaveLength(1);
    expect(await repo.get('settings', 'dateFormat')).toEqual({
      key: 'dateFormat',
      value: 'YYYY-MM-DD',
    });
    await repo.deleteMany([
      { store: 'documents', key: 'd' },
      { store: 'documentBytes', key: 'd' },
    ]);
    await repo.delete('signatures', 'a');
    expect(await repo.get('documents', 'd')).toBeUndefined();
    expect(await repo.getAll('signatures')).toEqual([]);
    await repo.flush();
  });

  it('keeps data across reopening', async () => {
    const factory = new IDBFactory();
    const first = await openRepository({ factory });
    await first.put('signatures', signature('kept'));
    const second = await openRepository({ factory });
    expect(await second.get('signatures', 'kept')).toMatchObject({ id: 'kept' });
  });

  it('falls back to memory on a quota error and keeps working (M3)', async () => {
    const repo = await openRepository({ factory: new IDBFactory() });
    const reasons: string[] = [];
    repo.onDegrade((reason) => reasons.push(reason));
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await repo.put('signatures', signature('big'));
    expect(reasons).toEqual(['full']);
    expect(repo.mode).toBe('memory');
    expect(await repo.get('signatures', 'big')).toMatchObject({ id: 'big' });
  });

  it('reports other failures as failed and stops degrading twice', async () => {
    const repo = await openRepository({ factory: new IDBFactory() });
    const reasons: string[] = [];
    repo.onDegrade((reason) => reasons.push(reason));
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new Error('broken');
    });
    await repo.delete('signatures', 'x');
    await repo.delete('signatures', 'y');
    expect(reasons).toEqual(['failed']);
    const late: string[] = [];
    repo.onDegrade((reason) => late.push(reason));
    expect(late).toEqual(['failed']);
  });

  it('clears everything only when the browser confirms (S7)', async () => {
    const factory = new IDBFactory();
    const repo = await openRepository({ factory });
    await repo.put('signatures', signature('a'));
    await repo.clearEverything();
    const reopened = await openRepository({ factory });
    expect(await reopened.getAll('signatures')).toEqual([]);
  });

  it('fails closed when another connection blocks the deletion', async () => {
    const factory = new IDBFactory();
    const repo = await openRepository({ factory, deleteTimeoutMs: 50 });
    const blocker = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
    });
    blocker.onversionchange = () => undefined; // refuses to close
    await expect(repo.clearEverything()).rejects.toBeInstanceOf(ClearFailedError);
    blocker.close();
  });
});

describe('repository without IndexedDB (M3)', () => {
  it('works in memory and reports unavailable', async () => {
    const repo = await openRepository({ factory: null });
    expect(repo.mode).toBe('memory');
    const reasons: string[] = [];
    repo.onDegrade((reason) => reasons.push(reason));
    expect(reasons).toEqual(['unavailable']);
    await repo.put('signatures', signature('m'));
    expect(await repo.getAll('signatures')).toHaveLength(1);
    await repo.clearEverything();
    expect(await repo.getAll('signatures')).toEqual([]);
  });

  it('treats an open that never finishes as unavailable', async () => {
    const hanging = { open: () => ({}) } as unknown as IDBFactory;
    const repo = await openRepository({ factory: hanging, openTimeoutMs: 20 });
    expect(repo.mode).toBe('memory');
  });

  it('treats a failed or blocked open as unavailable', async () => {
    for (const event of ['onerror', 'onblocked'] as const) {
      const failing = {
        open: () => {
          const request: Record<string, unknown> = { error: null };
          setTimeout(() => (request[event] as () => void)());
          return request;
        },
      } as unknown as IDBFactory;
      const repo = await openRepository({ factory: failing, openTimeoutMs: 1000 });
      expect(repo.mode).toBe('memory');
    }
  });

  it('uses the global indexedDB by default', async () => {
    const repo = await openRepository();
    expect(repo.mode).toBe('persistent');
  });
});

describe('startup', () => {
  it('installs the guards and attaches storage', async () => {
    const createPolicy = vi.fn();
    const target = Object.assign(new EventTarget(), {
      trustedTypes: { createPolicy },
      location: { origin: 'https://bogey.beta-site.us' },
    });
    await startup({ window: target as never, storage: { factory: null } });
    expect(createPolicy).toHaveBeenCalledWith('default', expect.anything());
    expect(useStorageStore.getState()).toMatchObject({
      mode: 'memory',
      degradeReason: 'unavailable',
    });
  });
});
