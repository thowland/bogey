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
