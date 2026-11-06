// Core text layout for the app (spec §7.2, §9.2): Helvetica metrics shared by the screen and
// export, field auto-size, WinAnsi checks and dates. Shared by Sprints 4, 5 and 7.
export {
  HELVETICA,
  autoFieldFontSize,
  formatDate,
  layoutText,
  nonWinAnsi,
  replaceNonWinAnsi,
  textWidth,
} from '@bogey/core';
// Sprint 4: export preflight (E4), output naming (D8) and the check mark's metrics (O4).
export { CHECK_GLYPH, X_MARK, outputFileName, preflightExport } from '@bogey/core';
