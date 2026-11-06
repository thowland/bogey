// Sealed edits for password-protected documents (security/sealing.ts) and the session controller's
// use of them: key derivation, round trip, fail-closed restore, and no plaintext at rest.
import 'fake-indexeddb/auto';
import type { Overlay, PdfInfo } from '@bogey/core';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveSealingKey,
  IV_BYTES,
  newSalt,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  sealEdits,
  unsealEdits,
} from '../src/security/sealing.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { openRepository, type DocumentRecord, type Repository } from '../src/state/persistence.ts';
import {
  createSessionController,
  persistOpenedBytes,
  provisionalRecord,
  useSessionStore,
  type SessionController,
} from '../src/state/session.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { fakeDocument } from './fakePdfjs.ts';

const MARKER = 'SSN-123-45-6789';
const FAST = 1_000;
const fastKey = (password: string, salt: ArrayBuffer) => deriveSealingKey(password, salt, FAST);

const overlay = {
  id: 'o1',
  type: 'text',
  page: 0,
  x: 72,
  y: 700,
  text: MARKER,
  size: 12,
  bold: false,
} as Overlay;
const EDITS = { fieldValues: { ssn: MARKER }, overlays: [overlay] };

const info = (encrypted: boolean): PdfInfo => ({
  formType: 'acroform',
  xfa: 'none',
  encrypted,
  decryptable: true,
  pageCount: 2,
  pages: [],
  fields: [],
  initialValues: {},
  metadata: {},
});

/** Everything a record holds, as text: JSON plus every ArrayBuffer decoded both ways. */
function serialize(value: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (Object.prototype.toString.call(node) === '[object ArrayBuffer]') {
      const bytes = new Uint8Array(node as ArrayBuffer);
      parts.push(new TextDecoder().decode(bytes), String.fromCharCode(...bytes));
    } else if (node && typeof node === 'object') {
      for (const child of Object.values(node)) walk(child);
    } else {
      parts.push(String(node));
    }
  };
  walk(value);
  return parts.join('\n') + JSON.stringify(value);
}

const flip = (buffer: ArrayBuffer, index = 0): ArrayBuffer => {
  const bytes = new Uint8Array(buffer.slice(0));
  bytes[index] = bytes[index]! ^ 1;
  return bytes.buffer;
};

describe('sealing (security/sealing.ts)', () => {
  it('round-trips the edits under the document id', async () => {
    const salt = newSalt();
    expect(salt.byteLength).toBe(SALT_BYTES);
    const key = await fastKey('bogey', salt);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    const sealed = await sealEdits(key, salt, 'doc-1', EDITS);
    expect(sealed.v).toBe(1);
    expect(sealed.iv.byteLength).toBe(IV_BYTES);
    expect(serialize(sealed)).not.toContain(MARKER);
    expect(await unsealEdits(key, 'doc-1', sealed)).toEqual(EDITS);
    // A fresh IV for every write.
    const again = await sealEdits(key, salt, 'doc-1', EDITS);
    expect(new Uint8Array(again.iv)).not.toEqual(new Uint8Array(sealed.iv));
  });

  it('derives the same key from the same password and salt with 600,000 iterations', async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const salt = newSalt();
    const sealed = await sealEdits(await deriveSealingKey('pw', salt), salt, 'd', EDITS);
    expect(await unsealEdits(await deriveSealingKey('pw', salt), 'd', sealed)).toEqual(EDITS);
    expect(await unsealEdits(await deriveSealingKey('other', salt), 'd', sealed)).toBeNull();
  });

  it('fails closed on a tampered IV or data, another id, or another version', async () => {
    const salt = newSalt();
    const key = await fastKey('bogey', salt);
    const sealed = await sealEdits(key, salt, 'doc-1', EDITS);
    expect(await unsealEdits(key, 'doc-1', { ...sealed, iv: flip(sealed.iv) })).toBeNull();
    expect(await unsealEdits(key, 'doc-1', { ...sealed, data: flip(sealed.data, 3) })).toBeNull();
    expect(await unsealEdits(key, 'doc-2', sealed)).toBeNull();
    expect(await unsealEdits(key, 'doc-1', { ...sealed, v: 2 as 1 })).toBeNull();
  });

  it('rejects ciphertext that does not hold an edit state', async () => {
    const salt = newSalt();
    const key = await fastKey('bogey', salt);
    const sealed = await sealEdits(key, salt, 'd', { fieldValues: [] as never, overlays: [] });
    expect(await unsealEdits(key, 'd', sealed)).toBeNull();
  });
});

describe('the session controller with sealed edits', () => {
  let repository: Repository;
  let controller: SessionController;

  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await repository.flush();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  function make(deriveKey = fastKey) {
    controller = createSessionController({
      repository,
      deriveKey,
      makeThumbnail: () => Promise.resolve(new ArrayBuffer(4)),
    });
    controller.start();
  }

  async function open(
    id: string,
    encrypted: boolean,
    password: string | null,
    saved?: DocumentRecord,
  ) {
    if (saved) {
      await repository.put('documents', saved);
      useSessionStore.getState().markSaved(id, true);
      controller.expect(saved);
    } else {
      await persistOpenedBytes(id, `${id}.pdf`, new Uint8Array([37]), {
        estimate: () => Promise.resolve(null),
        digest: () => Promise.resolve(''),
        now: () => 1,
      });
    }
    useDocumentStore.getState().update({
      status: 'ready',
      id,
      name: `${id}.pdf`,
      info: info(encrypted),
      display: fakeDocument(2),
      password,
    });
    await settle();
  }

  beforeEach(async () => {
    repository = await openRepository({ factory: new IDBFactory() });
    useStorageStore.getState().attach(repository);
  });

  afterEach(() => {
    controller.stop();
    useSessionStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('stores the edits of a password-protected document only in sealed form', async () => {
    make();
    await open('e', true, 'bogey');
    expect(useDocumentStore.getState().sealingKey).not.toBeNull();
    useEditsStore.getState().load(EDITS);
    await controller.flush();
    await settle();
    const stored = (await repository.get('documents', 'e'))!;
    expect(stored).toMatchObject({ fieldValues: {}, overlays: [], thumbnail: null });
    expect(stored.sealed).toBeDefined();
    expect(serialize(stored)).not.toContain(MARKER);
    expect(serialize(stored)).not.toContain('bogey');
    expect(JSON.stringify(useSessionStore.getState().recent)).not.toContain(MARKER);
    // The key is derived once per session; the salt stays the same across writes.
    const salt = new Uint8Array(stored.sealed!.salt);
    useEditsStore.getState().load({ fieldValues: { ssn: 'x' }, overlays: [] });
    await controller.flush();
    await settle();
    expect(new Uint8Array((await repository.get('documents', 'e'))!.sealed!.salt)).toEqual(salt);
  });

  it('restores sealed edits after the password opens the document again', async () => {
    make();
    await open('e', true, 'bogey');
    useEditsStore.getState().load(EDITS);
    await controller.flush();
    await settle();
    const saved = (await repository.get('documents', 'e'))!;
    useDocumentStore.getState().reset();
    useEditsStore.getState().reset();
    await settle();

    await open('e', true, 'bogey', saved);
    expect(useEditsStore.getState().present).toEqual(EDITS);
    expect(useSessionStore.getState().notice).toBeNull();
  });

  async function savedSealed(id: string): Promise<DocumentRecord> {
    const salt = newSalt();
    const key = await fastKey('bogey', salt);
    return {
      ...provisionalRecord(id, `${id}.pdf`, 1),
      encrypted: true,
      pageCount: 2,
      sealed: await sealEdits(key, salt, id, EDITS),
    };
  }

  it('opens without its edits, with a notice, when the sealed data was tampered with', async () => {
    make();
    const saved = await savedSealed('e');
    await open('e', true, 'bogey', {
      ...saved,
      sealed: { ...saved.sealed!, data: flip(saved.sealed!.data, 5) },
    });
    expect(useDocumentStore.getState().status).toBe('ready');
    expect(useEditsStore.getState().present).toEqual({ fieldValues: {}, overlays: [] });
    expect(useSessionStore.getState().notice).toBe('edits-unreadable');
  });

  it('fails closed when the IV was changed', async () => {
    make();
    const saved = await savedSealed('e');
    await open('e', true, 'bogey', {
      ...saved,
      sealed: { ...saved.sealed!, iv: flip(saved.sealed!.iv) },
    });
    expect(useSessionStore.getState().notice).toBe('edits-unreadable');
  });

  it('refuses a sealed blob moved onto another record', async () => {
    make();
    const donor = await savedSealed('a');
    await open('b', true, 'bogey', { ...donor, id: 'b', name: 'b.pdf' });
    expect(useEditsStore.getState().present.fieldValues).toEqual({});
    expect(useSessionStore.getState().notice).toBe('edits-unreadable');
  });

  it('never uses plaintext edits on a password-protected record', async () => {
    make();
    const plain: DocumentRecord = {
      ...provisionalRecord('e', 'e.pdf', 1),
      encrypted: true,
      fieldValues: { ssn: MARKER },
    };
    await open('e', true, 'bogey', plain);
    expect(useEditsStore.getState().present.fieldValues).toEqual({});
  });

  it('reports a key that cannot be derived, and saves no edits', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    make(() => Promise.reject(new Error('no crypto')));
    const saved = await savedSealed('e');
    await open('e', true, 'bogey', saved);
    expect(useSessionStore.getState().notice).toBe('edits-unreadable');
    useEditsStore.getState().load(EDITS);
    await controller.flush();
    await settle();
    const stored = (await repository.get('documents', 'e'))!;
    expect(serialize(stored)).not.toContain(MARKER);
    // The last sealed edits are kept rather than lost.
    expect(stored.sealed).toBeDefined();
    expect(error).toHaveBeenCalled();
  });

  it('never seals an empty state over saved edits while the key is being derived', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    make(async (password, salt) => {
      await gate;
      return fastKey(password, salt);
    });
    const saved = await savedSealed('e');
    await open('e', true, 'bogey', saved);
    // The open's own write and a page change both happen before the key exists.
    const { useViewStore } = await import('../src/state/view.ts');
    useViewStore.getState().setPage(1);
    const pending = controller.flush();
    release();
    await pending;
    await controller.flush();
    await settle();
    const stored = (await repository.get('documents', 'e'))!;
    expect(stored.lastPage).toBe(1);
    const key = await fastKey('bogey', stored.sealed!.salt);
    expect(await unsealEdits(key, 'e', stored.sealed!)).toEqual(EDITS);
  });

  it('drops a deferred write when the document closed before its edits came back', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    make(async (password, salt) => {
      await gate;
      return fastKey(password, salt);
    });
    const saved = await savedSealed('e');
    await open('e', true, 'bogey', saved);
    useDocumentStore.getState().reset();
    release();
    await settle();
    const stored = (await repository.get('documents', 'e'))!;
    const key = await fastKey('bogey', stored.sealed!.salt);
    expect(await unsealEdits(key, 'e', stored.sealed!)).toEqual(EDITS);
  });

  it('keeps edits made while the key was being derived', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    make(async (password, salt) => {
      await gate;
      return fastKey(password, salt);
    });
    const saved = await savedSealed('e');
    await open('e', true, 'bogey', saved);
    useEditsStore.getState().load({ fieldValues: { ssn: 'typed now' }, overlays: [] });
    release();
    await settle();
    expect(useEditsStore.getState().present.fieldValues).toEqual({ ssn: 'typed now' });
  });

  it('keeps plaintext edits for unencrypted and owner-password-only documents', async () => {
    make();
    await open('plain', false, null);
    useEditsStore.getState().load(EDITS);
    await controller.flush();
    await settle();
    expect(await repository.get('documents', 'plain')).toMatchObject({
      fieldValues: EDITS.fieldValues,
    });
    expect((await repository.get('documents', 'plain'))!.sealed).toBeUndefined();

    await open('owner', true, null);
    expect(useDocumentStore.getState().sealingKey).toBeNull();
  });

  it('ignores a key that arrives after the document closed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    make(async (password, salt) => {
      await gate;
      return fastKey(password, salt);
    });
    await open('e', true, 'bogey', await savedSealed('e'));
    useDocumentStore.getState().reset();
    release();
    await settle();
    expect(useDocumentStore.getState().sealingKey).toBeNull();
    expect(useSessionStore.getState().notice).toBeNull();
  });
});

describe('a document opened before storage was ready', () => {
  afterEach(() => useSessionStore.getState().reset());

  it('is saved, with its edits, once the session starts', async () => {
    useStorageStore.getState().reset();
    expect(await persistOpenedBytes('early', 'early.pdf', new Uint8Array([37]))).toBe(false);
    expect(useSessionStore.getState().deferred).toBe('early');
    useDocumentStore.getState().update({
      status: 'ready',
      id: 'early',
      name: 'early.pdf',
      info: info(false),
      display: fakeDocument(2),
      bytes: new Uint8Array([37, 80]),
    });
    useEditsStore.getState().load(EDITS);

    const repository = await openRepository({ factory: new IDBFactory() });
    useStorageStore.getState().attach(repository);
    const controller = createSessionController({ repository });
    controller.start();
    for (let i = 0; i < 8; i++) {
      await repository.flush();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(await repository.get('documentBytes', 'early')).toBeDefined();
    expect(await repository.get('documents', 'early')).toMatchObject({
      pageCount: 2,
      fieldValues: EDITS.fieldValues,
    });
    expect(useSessionStore.getState().deferred).toBeNull();
    controller.stop();
  });

  it('is forgotten if its open is cancelled', async () => {
    const { forgetOpenedBytes } = await import('../src/state/session.ts');
    useStorageStore.getState().reset();
    await persistOpenedBytes('early', 'early.pdf', new Uint8Array([37]));
    await forgetOpenedBytes('early');
    expect(useSessionStore.getState().deferred).toBeNull();
  });
});
