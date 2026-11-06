// Storage status for the banner (M3) and the repository the app shares. Owned by Sprint 6;
// Sprint 0 opens the repository at start-up so Sprint 3 can persist signatures.
import { create } from 'zustand';
import type { DegradeReason, Repository, StorageMode } from './persistence.ts';

export interface StorageState {
  repository: Repository | null;
  mode: StorageMode | 'opening';
  degradeReason: DegradeReason | null;
}

export interface StorageActions {
  attach(repository: Repository): void;
  reset(): void;
}

const initial: StorageState = { repository: null, mode: 'opening', degradeReason: null };

export const useStorageStore = create<StorageState & StorageActions>()((set) => ({
  ...initial,
  attach: (repository) => {
    set({ repository, mode: repository.mode });
    repository.onDegrade((degradeReason) => set({ mode: 'memory', degradeReason }));
  },
  reset: () => set(initial),
}));
