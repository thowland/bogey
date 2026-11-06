// The snippet profile (spec §10.6, N1–N4, M2). Owned by Sprint 7.
//
// Snippets are kept in the repository's `snippets` store, one record per snippet with its place in
// the list as `order`. They load as soon as the app's repository is attached. On first run the six
// empty snippets from N1 are written; the stored date format marks that first run as done, so a
// user who deletes every snippet does not get the defaults back.
import type { Snippet } from '@bogey/core';
import { create } from 'zustand';
import { DEFAULT_SNIPPET_LABELS } from '../core-bridge/model.ts';
import { SNIPPET_LIMITS } from '../core-bridge/snippets.ts';
import type { Repository } from './persistence.ts';
import { useSettingsStore } from './settings.ts';
import { useStorageStore } from './storage.ts';

export interface SnippetsState {
  /** In display order, numbered 0…n−1. */
  items: readonly Snippet[];
  loaded: boolean;
}

export interface SnippetsActions {
  /** Replaces the list in memory (tests, and the loader). */
  setAll(items: readonly Snippet[]): void;
  /** Reads the profile from the repository, seeding the defaults on first run (N1). */
  load(repository: Repository): Promise<void>;
  /** Adds an empty snippet at the end and returns it. */
  add(label?: string): Promise<Snippet>;
  /** Changes a snippet's label or value (N3). Text over the limits is cut. */
  edit(id: string, patch: { label?: string; value?: string }): Promise<void>;
  remove(id: string): Promise<void>;
  /** Puts the snippets in the order of `ids` (N3); ids not listed keep their relative order last. */
  reorder(ids: readonly string[]): Promise<void>;
  /** Replaces the whole list and saves it, for an import (M2). */
  replaceAll(items: readonly Snippet[]): Promise<void>;
  reset(): void;
}

const initial: SnippetsState = { items: [], loaded: false };

const cut = (text: string, max: number) => {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
};

const numbered = (items: readonly Snippet[]): Snippet[] =>
  items.map((item, order) => (item.order === order ? item : { ...item, order }));

const byOrder = (a: Snippet, b: Snippet) => a.order - b.order;

const newId = () => crypto.randomUUID();

const repository = () => useStorageStore.getState().repository;

/** Writes the records that differ from `before` and deletes the ones that are gone. */
async function save(
  before: readonly Snippet[],
  after: readonly Snippet[],
  repo: Repository | null = repository(),
): Promise<void> {
  if (!repo) return;
  const old = new Map(before.map((item) => [item.id, item]));
  const changed = after.filter((item) => old.get(item.id) !== item);
  const kept = new Set(after.map((item) => item.id));
  const gone = before.filter((item) => !kept.has(item.id));
  if (changed.length > 0) {
    await repo.putMany(changed.map((value) => ({ store: 'snippets' as const, value })));
  }
  if (gone.length > 0) {
    await repo.deleteMany(gone.map((item) => ({ store: 'snippets' as const, key: item.id })));
  }
}

/** The six empty snippets of N1. */
export const defaultSnippets = (): Snippet[] =>
  DEFAULT_SNIPPET_LABELS.map((label, order) => ({ id: newId(), label, value: '', order }));

/** Whether a stored value has the shape of a snippet. */
const isSnippet = (value: unknown): value is Snippet => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.value === 'string' &&
    typeof v.order === 'number' &&
    Number.isFinite(v.order)
  );
};

export const useSnippetsStore = create<SnippetsState & SnippetsActions>()((set, get) => {
  /** Sets the new list and saves the difference. */
  const commit = (next: readonly Snippet[]) => {
    const before = get().items;
    const items = numbered(next);
    set({ items });
    return save(before, items);
  };

  return {
    ...initial,
    setAll: (items) => set({ items: numbered([...items].sort(byOrder)), loaded: true }),

    load: async (repo) => {
      const [records, marker] = await Promise.all([
        repo.getAll('snippets'),
        repo.get('settings', 'dateFormat'),
      ]);
      const stored = records.filter(isSnippet).sort(byOrder);
      if (stored.length === 0 && marker === undefined) {
        const seeded = defaultSnippets();
        set({ items: seeded, loaded: true });
        await repo.putMany([
          ...seeded.map((value) => ({ store: 'snippets' as const, value })),
          {
            store: 'settings' as const,
            value: { key: 'dateFormat' as const, value: useSettingsStore.getState().dateFormat },
          },
        ]);
        return;
      }
      const items = numbered(stored);
      set({ items, loaded: true });
      // Repair orders with gaps or ties, so the stored order is the shown order.
      await save(stored, items, repo);
    },

    add: async (label = '') => {
      const snippet: Snippet = {
        id: newId(),
        label: cut(label, SNIPPET_LIMITS.maxLabel),
        value: '',
        order: get().items.length,
      };
      await commit([...get().items, snippet]);
      return snippet;
    },

    edit: async (id, patch) => {
      const items = get().items;
      const current = items.find((item) => item.id === id);
      if (!current) return;
      const next: Snippet = {
        ...current,
        ...(patch.label !== undefined ? { label: cut(patch.label, SNIPPET_LIMITS.maxLabel) } : {}),
        ...(patch.value !== undefined ? { value: cut(patch.value, SNIPPET_LIMITS.maxValue) } : {}),
      };
      if (next.label === current.label && next.value === current.value) return;
      await commit(items.map((item) => (item.id === id ? next : item)));
    },

    remove: async (id) => {
      await commit(get().items.filter((item) => item.id !== id));
    },

    reorder: async (ids) => {
      const items = get().items;
      const rank = new Map(ids.map((id, index) => [id, index]));
      const listed = items.filter((item) => rank.has(item.id));
      listed.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
      await commit([...listed, ...items.filter((item) => !rank.has(item.id))]);
    },

    replaceAll: async (next) => {
      await commit([...next].sort(byOrder));
    },

    reset: () => set(initial),
  };
});

// The profile loads as soon as the app's repository is attached at start-up, whether or not the
// Snippets panel is open.
let loadedFrom: Repository | null = null;
function loadFrom(repo: Repository | null) {
  if (!repo || repo === loadedFrom) return;
  loadedFrom = repo;
  useSnippetsStore
    .getState()
    .load(repo)
    .catch((error: unknown) => console.error('Snippets could not be loaded', error));
}
loadFrom(useStorageStore.getState().repository);
useStorageStore.subscribe(({ repository: repo }) => loadFrom(repo));
