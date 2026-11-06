// App limits and timings (spec §11.8). These protect browser memory and storage; they belong to
// the app, not to core, and every value here is referenced by the spec section that uses it.

export const LIMITS = Object.freeze({
  /** D2. */
  maxFileBytes: 50 * 1024 * 1024,
  maxPages: 2_000,
  /** Pages above this open with a notice that rendering will be slow on iPad (spec §6.1). */
  slowPageCount: 300,
  /** D6. */
  recentDocuments: 20,
  /** spec §10.5: documents untouched this long are deleted on load. */
  documentExpiryDays: 30,
  /** spec §10.5: above this share of quota, a document opens in memory only. */
  storageQuotaShare: 0.8,
  /** iOS Safari's per-canvas limit (spec §10.3). */
  maxCanvasPixels: 16_777_216,
  /** V6: pages either side of the current one that keep a full canvas. */
  renderedNeighbors: 1,
  /** spec §10.3: pages further away than this are cleaned up in pdf.js. */
  cleanupDistance: 5,
  thumbnailCache: 60,
  thumbnailWidth: 120,
  recordThumbnailWidth: 200,
  maxConcurrentRenders: 2,
  /** spec §8.2. */
  maxSignatureUploadBytes: 20 * 1024 * 1024,
  maxSignatureEdge: 2_000,
  /** O8. */
  undoSteps: 100,
  /** spec §10.6. */
  maxSnippetFileBytes: 256 * 1024,
  maxSnippets: 200,
});

export const TIMING = Object.freeze({
  /** M1. */
  autosaveMs: 500,
  /** spec §10.5: IndexedDB that has not opened by then counts as unavailable. */
  storageOpenTimeoutMs: 3_000,
  /** spec §10.5: a database deletion still blocked after this counts as failed. */
  deleteBlockedTimeoutMs: 5_000,
  inspectTimeoutMs: 30_000,
  renderTimeoutMs: 20_000,
  exportTimeoutMs: 60_000,
  /** E7. */
  exportProgressAfterMs: 500,
  /** spec §9.1: Safari reads blob URLs after the click. */
  revokeDownloadUrlAfterMs: 60_000,
  /** spec §7.4. */
  coalesceIdleMs: 1_000,
});

export const CANONICAL_URL = 'https://bogey.beta-site.us';
