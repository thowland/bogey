// The signature library (spec §8.3, G1). Owned by Sprint 3.
//
// Signatures are kept in the repository's `signatures` store with their PNG as an ArrayBuffer
// (WebKit aborts IndexedDB writes that hold Blobs, spec §10.5); in memory the app holds the PNG
// as a Blob, for thumbnails, placement and export. The conversion happens only here.
import type { SignatureKind, SignatureMeta } from '@bogey/core';
import { create } from 'zustand';
import type { Repository, SignatureRecord } from './persistence.ts';
import { useStorageStore } from './storage.ts';

export interface SignaturesState {
  /** Oldest first. */
  items: readonly SignatureMeta[];
  /** PNG per signature id, for thumbnails, placement and export. */
  images: ReadonlyMap<string, Blob>;
  loaded: boolean;
}

export interface NewSignature {
  name: string;
  kind: SignatureKind;
  png: Blob;
  width: number;
  height: number;
}

export interface SignaturesActions {
  setAll(items: readonly SignatureMeta[], images: ReadonlyMap<string, Blob>): void;
  /**
   * Reads the library from the repository. Signatures added before it finishes (or before the
   * repository opened) are kept, and written to the repository if it does not have them.
   */
  load(repository: Repository): Promise<void>;
  add(signature: NewSignature): Promise<SignatureMeta>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  reset(): void;
}

/** Longest name kept; longer names are cut. */
export const MAX_SIGNATURE_NAME = 100;

export const DEFAULT_NAMES: Readonly<Record<SignatureKind, string>> = {
  signature: 'Signature',
  initials: 'Initials',
};

/** A trimmed name, or the kind's default when nothing is left. */
export function cleanName(name: string, kind: SignatureKind): string {
  const trimmed = name.trim().slice(0, MAX_SIGNATURE_NAME);
  return trimmed || DEFAULT_NAMES[kind];
}

const PNG = 'image/png';

const metaOf = (record: SignatureRecord): SignatureMeta => ({
  id: record.id,
  name: record.name,
  kind: record.kind,
  width: record.width,
  height: record.height,
  createdAt: record.createdAt,
});

async function recordOf(meta: SignatureMeta, png: Blob): Promise<SignatureRecord> {
  return { ...meta, png: await png.arrayBuffer() };
}

const byAge = (a: SignatureMeta, b: SignatureMeta) => a.createdAt - b.createdAt;

const repository = () => useStorageStore.getState().repository;

const initial: SignaturesState = { items: [], images: new Map(), loaded: false };

export const useSignaturesStore = create<SignaturesState & SignaturesActions>()((set, get) => ({
  ...initial,

  setAll: (items, images) => set({ items, images, loaded: true }),

  load: async (repo) => {
    const records = await repo.getAll('signatures');
    const stored = new Set(records.map((record) => record.id));
    const { items, images } = get();
    const unsaved = items.filter((item) => !stored.has(item.id));
    const nextImages = new Map(images);
    for (const record of records) nextImages.set(record.id, new Blob([record.png], { type: PNG }));
    set({
      items: [...records.map(metaOf), ...unsaved].sort(byAge),
      images: nextImages,
      loaded: true,
    });
    for (const item of unsaved) {
      const png = nextImages.get(item.id);
      if (png) await repo.put('signatures', await recordOf(item, png));
    }
  },

  add: async ({ name, kind, png, width, height }) => {
    const meta: SignatureMeta = {
      id: crypto.randomUUID(),
      name: cleanName(name, kind),
      kind,
      width,
      height,
      createdAt: Date.now(),
    };
    set((state) => ({
      items: [...state.items, meta],
      images: new Map(state.images).set(meta.id, png),
    }));
    const repo = repository();
    if (repo) await repo.put('signatures', await recordOf(meta, png));
    return meta;
  },

  rename: async (id, name) => {
    const current = get().items.find((item) => item.id === id);
    if (!current) return;
    const renamed = { ...current, name: cleanName(name, current.kind) };
    set((state) => ({ items: state.items.map((item) => (item.id === id ? renamed : item)) }));
    const png = get().images.get(id);
    const repo = repository();
    if (repo && png) await repo.put('signatures', await recordOf(renamed, png));
  },

  remove: async (id) => {
    set((state) => {
      const images = new Map(state.images);
      images.delete(id);
      return { items: state.items.filter((item) => item.id !== id), images };
    });
    await repository()?.delete('signatures', id);
  },

  reset: () => set(initial),
}));

// The library loads as soon as the app's repository is attached at start-up, whether or not the
// Signatures panel is open, so placed signatures (S4) and export find their images.
let loadedFrom: Repository | null = null;
function loadFrom(repo: Repository | null) {
  if (!repo || repo === loadedFrom) return;
  loadedFrom = repo;
  useSignaturesStore
    .getState()
    .load(repo)
    .catch((error: unknown) => console.error('Signature library could not be loaded', error));
}
loadFrom(useStorageStore.getState().repository);
useStorageStore.subscribe(({ repository: repo }) => loadFrom(repo));
