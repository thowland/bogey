// Undo and redo (spec §7.4, O8): immutable snapshots that share structure, a step limit, and
// coalescing so that typing into one control or nudging one overlay is a single step.
import type { DocumentEditState, Edit, History } from '../model/document.ts';
import { applyEdit, type EditContext } from './edits.ts';

/** O8 requires 50; Bogey keeps 100 (spec §7.4). */
export const HISTORY_LIMIT = 100;
/** Edits with the same coalesce key closer together than this fold into one step. */
export const COALESCE_IDLE_MS = 1_000;

export function createHistory(state: DocumentEditState, opts?: { limit?: number }): History {
  const limit = Math.max(1, Math.floor(opts?.limit ?? HISTORY_LIMIT));
  return { past: [], present: state, future: [], lastCoalesceKey: null, lastEditAt: 0, limit };
}

export interface HistoryApplyOptions {
  /** Field name, overlay id or similar; consecutive edits with one key form one step. */
  coalesceKey?: string;
  /** Epoch ms of the edit; defaults to now. */
  now?: number;
  idleMs?: number;
}

/** Applies an edit and records it. Invalid and no-op edits return `h` unchanged. */
export function historyApply(
  h: History,
  edit: Edit,
  ctx: EditContext,
  opts: HistoryApplyOptions = {},
): History {
  const present = applyEdit(h.present, edit, ctx);
  if (present === h.present) return h;
  const now = opts.now ?? Date.now();
  const key = opts.coalesceKey ?? null;
  const coalesce =
    key !== null &&
    key === h.lastCoalesceKey &&
    now - h.lastEditAt <= (opts.idleMs ?? COALESCE_IDLE_MS);
  if (coalesce) return { ...h, present, future: [], lastEditAt: now };
  const past = [...h.past, h.present];
  if (past.length > h.limit) past.splice(0, past.length - h.limit);
  return { ...h, past, present, future: [], lastCoalesceKey: key, lastEditAt: now };
}

/** Ends the current coalescing run (blur, pointerup), so the next edit starts a new step. */
export function sealHistory(h: History): History {
  return h.lastCoalesceKey === null ? h : { ...h, lastCoalesceKey: null };
}

export function undo(h: History): History {
  const previous = h.past.at(-1);
  if (previous === undefined) return h;
  return {
    ...h,
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    lastCoalesceKey: null,
  };
}

export function redo(h: History): History {
  const [next, ...future] = h.future;
  if (next === undefined) return h;
  return {
    ...h,
    past: [...h.past, h.present],
    present: next,
    future,
    lastCoalesceKey: null,
  };
}

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;
