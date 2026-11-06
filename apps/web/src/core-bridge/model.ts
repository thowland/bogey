// Core constants the app's stores and components need at runtime (spec §2.1: core runtime code
// is reached only through core-bridge/). Add re-exports here rather than importing core directly.
export {
  CHECK,
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_SNIPPET_LABELS,
  EMPTY_EDIT_STATE,
  OVERLAY_TYPES,
  PROBLEM_CODES,
  SIGNATURE_DEFAULT_WIDTH,
  TEXT,
} from '@bogey/core';
