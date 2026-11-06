// The signature library (spec §8.3, G1). Owned by Sprint 3.
import type { SignatureMeta } from '@bogey/core';
import { create } from 'zustand';

export interface SignaturesState {
  items: readonly SignatureMeta[];
  /** PNG per signature id, for thumbnails, placement and export. */
  images: ReadonlyMap<string, Blob>;
  loaded: boolean;
}

export interface SignaturesActions {
  setAll(items: readonly SignatureMeta[], images: ReadonlyMap<string, Blob>): void;
  reset(): void;
}

const initial: SignaturesState = { items: [], images: new Map(), loaded: false };

export const useSignaturesStore = create<SignaturesState & SignaturesActions>()((set) => ({
  ...initial,
  setAll: (items, images) => set({ items, images, loaded: true }),
  reset: () => set(initial),
}));
