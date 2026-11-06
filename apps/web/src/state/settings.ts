// User settings (spec §10.6, O3, O5). Owned by Sprint 7.
import type { DateFormat } from '@bogey/core';
import { DEFAULT_DATE_FORMAT, TEXT } from '../core-bridge/model.ts';
import { create } from 'zustand';

export interface SettingsState {
  dateFormat: DateFormat;
  defaultFontSize: number;
}

export interface SettingsActions {
  update(patch: Partial<SettingsState>): void;
  reset(): void;
}

const initial: SettingsState = {
  dateFormat: DEFAULT_DATE_FORMAT,
  defaultFontSize: TEXT.defaultSize,
};

export const useSettingsStore = create<SettingsState & SettingsActions>()((set) => ({
  ...initial,
  update: (patch) => set(patch),
  reset: () => set(initial),
}));
