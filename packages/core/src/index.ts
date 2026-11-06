// Public API of @bogey/core (spec §4). Sprint 0 fixes the contracts; implementations arrive in
// Sprints 2 (geometry, inspection, edits, export), 3 (signature image ops) and 7 (snippets).
export * from './result.ts';
export type * from './model/geometry.ts';
export type * from './model/fields.ts';
export * from './model/overlays.ts';
export * from './model/document.ts';
export type * from './model/export.ts';
export * from './model/library.ts';
export * from './model/text.ts';
// Sprint 2: PDF core.
export * from './geometry/index.ts';
export {
  classify,
  hasPdfHeader,
  inspectPdf,
  readPageGeometry,
  type InspectProblem,
} from './inspect/index.ts';
export * from './history/index.ts';
export * from './text/index.ts';
export {
  CHECK_GLYPH,
  PRODUCER,
  X_MARK,
  exportPageImages,
  exportPdf,
  preflightExport,
  type ExportPageImagesInput,
  type PageImage,
} from './export/index.ts';
export { outputFileName } from './naming.ts';
// Sprint 3: signature image ops.
export * from './image/index.ts';
// Sprint 7: snippet files and merging.
export * from './snippets/index.ts';
