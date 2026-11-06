// The snippet profile (spec §10.6, N1–N4). Owned by Sprint 7.
import type { Snippet } from '@bogey/core';
import { create } from 'zustand';

export interface SnippetsState {
  items: readonly Snippet[];
  loaded: boolean;
}

export interface SnippetsActions {
  setAll(items: readonly Snippet[]): void;
  reset(): void;
}

const initial: SnippetsState = { items: [], loaded: false };

export const useSnippetsStore = create<SnippetsState & SnippetsActions>()((set) => ({
  ...initial,
  setAll: (items) => set({ items: [...items].sort((a, b) => a.order - b.order), loaded: true }),
  reset: () => set(initial),
}));
