// The Vite plugin that publishes pdf.js's data files at /pdfjs/ (spec §10.3), and the options
// that point pdf.js at them.
import { describe, expect, it, vi } from 'vitest';
import { pdfjsAssets, pdfjsAssetsPlugin } from '../plugins/pdfjsAssets.ts';
import { DOCUMENT_OPTIONS, PDFJS_ASSET_BASE } from '../src/pdfjs/options.ts';

describe('pdf.js assets', () => {
  const files = pdfjsAssets().map((asset) => asset.fileName);

  it('publishes fonts, CMaps, WASM decoders and ICC profiles, but not the scripting sandbox', () => {
    for (const expected of [
      'pdfjs/standard_fonts/LiberationSans-Regular.ttf',
      'pdfjs/cmaps/UniJIS-UTF8-H.bcmap',
      'pdfjs/wasm/openjpeg.wasm',
      'pdfjs/wasm/openjpeg_nowasm_fallback.js',
      'pdfjs/wasm/jbig2.wasm',
      'pdfjs/wasm/qcms_bg.wasm',
      'pdfjs/iccs/CGATS001Compat-v2-micro.icc',
    ]) {
      expect(files).toContain(expected);
    }
    expect(files.filter((file) => /quickjs/i.test(file))).toEqual([]);
  });

  it('matches the URLs pdf.js is given', () => {
    for (const url of [
      DOCUMENT_OPTIONS.standardFontDataUrl,
      DOCUMENT_OPTIONS.cMapUrl,
      DOCUMENT_OPTIONS.wasmUrl,
      DOCUMENT_OPTIONS.iccUrl,
    ]) {
      expect(url.startsWith(PDFJS_ASSET_BASE)).toBe(true);
      expect(files.some((file) => `/${file}`.startsWith(url))).toBe(true);
    }
    expect(DOCUMENT_OPTIONS).toMatchObject({
      enableXfa: false,
      useSystemFonts: false,
      disableWorkerRendering: true,
    });
    expect(DOCUMENT_OPTIONS).not.toHaveProperty('enableScripting');
  });

  it('emits every file into the build', () => {
    const plugin = pdfjsAssetsPlugin();
    const emitFile = vi.fn();
    (plugin.generateBundle as (this: unknown) => void).call({ emitFile });
    expect(emitFile).toHaveBeenCalledTimes(files.length);
    expect(emitFile.mock.calls[0]![0]).toMatchObject({ type: 'asset', fileName: files[0] });
  });

  it('serves the files in dev with the right content type, and passes on everything else', () => {
    const plugin = pdfjsAssetsPlugin();
    let handler!: (req: { url?: string }, res: unknown, next: () => void) => void;
    (plugin.configureServer as (server: unknown) => void)({
      middlewares: { use: (fn: typeof handler) => (handler = fn) },
    });
    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    handler({ url: '/pdfjs/wasm/openjpeg.wasm?v=1' }, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/wasm');
    handler({ url: '/pdfjs/wasm/jbig2_nowasm_fallback.js' }, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/javascript');
    handler({ url: '/pdfjs/cmaps/UniJIS-UTF8-H.bcmap' }, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    expect(res.end).toHaveBeenCalledTimes(3);
    handler({ url: '/pdfjs/wasm/quickjs-eval.wasm' }, res, next);
    handler({}, res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
