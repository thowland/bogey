// Edit history for the active document (spec §7.3, §7.4). Owned by Sprint 2, which wires these
// actions to core's applyEdit and History. Until then the store holds state without history.
import type { DocumentEditState, Edit } from '@bogey/core';
import { EMPTY_EDIT_STATE } from '../core-bridge/model.ts';
import { create } from 'zustand';

export interface EditOptions {
  /** Edits with the same key close together fold into one undo step (spec §7.4). */
  coalesceKey?: string;
}

export interface EditsState {
  present: DocumentEditState;
  canUndo: boolean;
  canRedo: boolean;
}

export interface EditsActions {
  /** Replaces the state and clears history (open or restore). */
  load(state: DocumentEditState): void;
  edit(edit: Edit, options?: EditOptions): void;
  undo(): void;
  redo(): void;
  reset(): void;
}

const initial: EditsState = { present: EMPTY_EDIT_STATE, canUndo: false, canRedo: false };

export const useEditsStore = create<EditsState & EditsActions>()((set) => ({
  ...initial,
  load: (present) => set({ present, canUndo: false, canRedo: false }),
  // Sprint 2 replaces these with core's history reducer.
  edit: () => undefined,
  undo: () => undefined,
  redo: () => undefined,
  reset: () => set(initial),
}));
