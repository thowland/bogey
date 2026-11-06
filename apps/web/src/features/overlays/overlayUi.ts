// Small UI state the overlay feature shares between the toolbar and the page layer: the mark new
// checks use, the text overlay being edited, and the message for the polite live region (spec §13).
import type { TextOverlay } from '@bogey/core';
import { create } from 'zustand';

export interface OverlayUiState {
  /** O4: the mark a new check overlay gets; the last one chosen. */
  glyph: 'check' | 'x';
  /** The text or date overlay whose text is being edited, if any. */
  editingId: string | null;
  /** A text overlay just placed, shown for typing but not in the document until it has text. */
  draft: TextOverlay | null;
  /** Announced through the toolbar's live region. */
  announcement: string;
  setGlyph(glyph: 'check' | 'x'): void;
  setEditing(id: string | null, draft?: TextOverlay | null): void;
  announce(text: string): void;
  reset(): void;
}

const initial = {
  glyph: 'check' as const,
  editingId: null,
  draft: null,
  announcement: '',
};

export const useOverlayUi = create<OverlayUiState>()((set) => ({
  ...initial,
  setGlyph: (glyph) => set({ glyph }),
  setEditing: (editingId, draft = null) => set({ editingId, draft }),
  // A repeated message still changes the text node, so screen readers announce it again.
  announce: (text) =>
    set((state) => ({ announcement: state.announcement === text ? `${text}\u00a0` : text })),
  reset: () => set(initial),
}));
