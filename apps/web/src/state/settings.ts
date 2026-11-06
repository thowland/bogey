// User settings (spec §10.5, §10.6, O3, O5). Owned by Sprint 7.
//
// The date format and default text size are kept in the repository's `settings` store under the
// keys `dateFormat` and `defaultFontSize`. They load as soon as the app's repository is attached,
// and each change is written at once. A stored value the app does not recognise is ignored.
import type { DateFormat } from '@bogey/core';
import { create } from 'zustand';
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, TEXT } from '../core-bridge/model.ts';
import type { Repository } from './persistence.ts';
import { useStorageStore } from './storage.ts';

export interface SettingsState {
  dateFormat: DateFormat;
  defaultFontSize: number;
  loaded: boolean;
}

export type SettingsPatch = Partial<Pick<SettingsState, 'dateFormat' | 'defaultFontSize'>>;

export interface SettingsActions {
  /** Changes settings in memory only (tests, and the loader). */
  update(patch: SettingsPatch): void;
  /** Changes settings and saves them. Invalid values are ignored. */
  change(patch: SettingsPatch): Promise<void>;
  /** Reads the saved settings from the repository. */
  load(repository: Repository): Promise<void>;
  reset(): void;
}

const initial: SettingsState = {
  dateFormat: DEFAULT_DATE_FORMAT,
  defaultFontSize: TEXT.defaultSize,
  loaded: false,
};

export const isDateFormat = (value: unknown): value is DateFormat =>
  typeof value === 'string' && (DATE_FORMATS as readonly string[]).includes(value);

/** A whole number of points in the text size range (O3). */
export const isFontSize = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= TEXT.minSize &&
  value <= TEXT.maxSize;

/** The valid part of a patch, which may hold anything read back from storage. */
function valid(patch: { dateFormat?: unknown; defaultFontSize?: unknown }): SettingsPatch {
  const out: SettingsPatch = {};
  if (isDateFormat(patch.dateFormat)) out.dateFormat = patch.dateFormat;
  if (isFontSize(patch.defaultFontSize)) out.defaultFontSize = patch.defaultFontSize;
  return out;
}

const repository = () => useStorageStore.getState().repository;

export const useSettingsStore = create<SettingsState & SettingsActions>()((set) => ({
  ...initial,
  update: (patch) => set(valid(patch)),
  change: async (patch) => {
    const next = valid(patch);
    set(next);
    const repo = repository();
    if (!repo) return;
    const writes = [];
    if (next.dateFormat !== undefined) {
      writes.push({
        store: 'settings' as const,
        value: { key: 'dateFormat' as const, value: next.dateFormat },
      });
    }
    if (next.defaultFontSize !== undefined) {
      writes.push({
        store: 'settings' as const,
        value: { key: 'defaultFontSize' as const, value: next.defaultFontSize },
      });
    }
    if (writes.length > 0) await repo.putMany(writes);
  },
  load: async (repo) => {
    const [dateFormat, defaultFontSize] = await Promise.all([
      repo.get('settings', 'dateFormat'),
      repo.get('settings', 'defaultFontSize'),
    ]);
    set({
      ...valid({
        dateFormat: dateFormat?.value,
        defaultFontSize: defaultFontSize?.value,
      }),
      loaded: true,
    });
  },
  reset: () => set(initial),
}));

// Settings load as soon as the app's repository is attached at start-up, like the signature
// library, so overlays placed before the Settings dialog is ever opened use them.
let loadedFrom: Repository | null = null;
function loadFrom(repo: Repository | null) {
  if (!repo || repo === loadedFrom) return;
  loadedFrom = repo;
  useSettingsStore
    .getState()
    .load(repo)
    .catch((error: unknown) => console.error('Settings could not be loaded', error));
}
loadFrom(useStorageStore.getState().repository);
useStorageStore.subscribe(({ repository: repo }) => loadFrom(repo));
