// Edit history for the active document (spec §7.3, §7.4). Owned by Sprint 2. Edits are validated
// by core against the document's fields and pages; undo keeps LIMITS.undoSteps steps, and edits
// with one coalesce key within TIMING.coalesceIdleMs form one step until seal() (blur, pointerup).
import type { DocumentEditState, Edit, History } from '@bogey/core';
import {
  canRedo,
  canUndo,
  createHistory,
  historyApply,
  redo,
  sealHistory,
  undo,
  type EditContext,
} from '../core-bridge/history.ts';
import { EMPTY_EDIT_STATE } from '../core-bridge/model.ts';
import { LIMITS, TIMING } from '../config.ts';
import { create } from 'zustand';
import { useDocumentStore } from './document.ts';

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
  /**
   * Replaces the state and clears history (open or restore). `context` is the document's fields
   * and page count; without it, edits are validated against the document store's PdfInfo.
   */
  load(state: DocumentEditState, context?: EditContext): void;
  /** Applies a validated edit; invalid edits change nothing. */
  edit(edit: Edit, options?: EditOptions): void;
  undo(): void;
  redo(): void;
  /** Ends the current coalescing run, so the next edit is a new undo step. */
  seal(): void;
  reset(): void;
}

interface Internal {
  history: History;
  context: EditContext | null;
}

const fresh = (present: DocumentEditState, context: EditContext | null): EditsState & Internal => ({
  present,
  canUndo: false,
  canRedo: false,
  history: createHistory(present, { limit: LIMITS.undoSteps }),
  context,
});

const view = (history: History) => ({
  history,
  present: history.present,
  canUndo: canUndo(history),
  canRedo: canRedo(history),
});

export const useEditsStore = create<EditsState & EditsActions & Internal>()((set, get) => ({
  ...fresh(EMPTY_EDIT_STATE, null),
  load: (present, context) => set(fresh(present, context ?? null)),
  edit: (edit, options) => {
    const { history, context } = get();
    const ctx = context ?? useDocumentStore.getState().info;
    if (!ctx) return;
    const next = historyApply(history, edit, ctx, {
      ...(options?.coalesceKey !== undefined ? { coalesceKey: options.coalesceKey } : {}),
      now: Date.now(),
      idleMs: TIMING.coalesceIdleMs,
    });
    if (next !== history) set(view(next));
  },
  undo: () => set(view(undo(get().history))),
  redo: () => set(view(redo(get().history))),
  seal: () => set({ history: sealHistory(get().history) }),
  reset: () => set(fresh(EMPTY_EDIT_STATE, null)),
}));
