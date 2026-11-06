// Core's edit reducer and undo history (spec §7.3, §7.4), for state/edits.ts. Runtime imports
// of @bogey/core go through core-bridge/ (spec §2.1).
export {
  applyEdit,
  canRedo,
  canUndo,
  createHistory,
  historyApply,
  redo,
  sealHistory,
  undo,
} from '@bogey/core';
export type { EditContext, HistoryApplyOptions } from '@bogey/core';
