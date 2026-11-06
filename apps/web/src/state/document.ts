// The active document session (spec §10.2). Owned by Sprint 1; Sprint 6 adds persistence around
// it in state/session.ts. Bytes and the password live here, in memory only (spec §10.5, D3).
import type { PdfInfo, Problem } from '@bogey/core';
import { create } from 'zustand';
import type { PdfDisplayDocument } from '../pdfjs/types.ts';

export type DocumentStatus = 'empty' | 'opening' | 'password' | 'ready' | 'error';

export interface DocumentState {
  status: DocumentStatus;
  id: string | null;
  name: string | null;
  /** The original bytes (E1). Never mutated; pdf.js always receives a copy. */
  bytes: Uint8Array | null;
  info: PdfInfo | null;
  /** The document as loaded into pdf.js for display (spec §10.3). */
  display: PdfDisplayDocument | null;
  /** Held for the session only, never persisted (D3). */
  password: string | null;
  /**
   * The key sealing this document's saved edits, derived from the password (Sprint 6,
   * security/sealing.ts). Memory only, never stored; null for documents without a password.
   */
  sealingKey: CryptoKey | null;
  problem: Problem | null;
}

export interface DocumentActions {
  update(patch: Partial<DocumentState>): void;
  reset(): void;
}

const initial: DocumentState = {
  status: 'empty',
  id: null,
  name: null,
  bytes: null,
  info: null,
  display: null,
  password: null,
  sealingKey: null,
  problem: null,
};

export const useDocumentStore = create<DocumentState & DocumentActions>()((set) => ({
  ...initial,
  update: (patch) => set(patch),
  reset: () => set(initial),
}));
