// pdf.js loading options (spec §10.3). Kept apart from loader.ts, which imports pdfjs-dist, so the
// values can be checked without loading pdf.js.

/** Where the Vite plugin (plugins/pdfjsAssets.ts) puts pdf.js's data files. */
export const PDFJS_ASSET_BASE = '/pdfjs/';

/**
 * The fixed `getDocument` options. pdf.js 6.5.438 has no `isEvalSupported` option: the font
 * compiler that used `new Function` (CVE-2024-4367) was removed upstream, and the build contains no
 * eval path (docs/spikes/S1-pdfjs.md). Scripting is never enabled and XFA is never rendered.
 */
export const DOCUMENT_OPTIONS = Object.freeze({
  enableXfa: false,
  standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
  cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
  cMapPacked: true,
  // JPEG 2000 and JBIG2 decoders, ICC colour management and PostScript functions run as WASM.
  wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
  iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  useSystemFonts: false,
  disableFontFace: false,
  // Pages render on the main thread into our own canvases. Worker rendering would need a third
  // worker script, which the Trusted Types policy does not admit.
  disableWorkerRendering: true,
});
