# Sprint 1 spike: pdf.js under the production headers

Date: 2026-11-06 · pdfjs-dist 6.5.438 · Playwright's Chromium, Firefox and WebKit

This records what the Sprint 1 spike found, for the main session to fold into the spec (§10.3, §11.3, §16.3 items 2–4). The spec itself is unchanged.

## Setup

pdf.js runs with the options in `apps/web/src/pdfjs/options.ts`: `enableXfa: false`, standard fonts, CMaps, WASM and ICC profiles from `/pdfjs/`, `useSystemFonts: false`, `disableFontFace: false`, and `disableWorkerRendering: true`. The worker is `new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })`, which Vite builds as `/assets/pdf.worker.min-<hash>.js`. The Trusted Types default policy from Sprint 0 already admits that name.

The E2E specs in `e2e/viewer.spec.ts` open and render fixtures under the production headers with the violation fixture active, in all three engines. They cover a flat page with a standard font (`flat-single.pdf`), JBIG2 and JPEG 2000 images (`fetched/pdfjs/issue3371.pdf`), embedded TrueType, CFF and Type0 fonts with ICC colour (`with_cropbox.pdf`, `habibi-rotated.pdf`, `fw9.pdf`), and an encrypted file through the password dialog. All pass. **No header change is needed.**

## 1. pdf.js 6.5.438 uses WebAssembly, so `'wasm-unsafe-eval'` stays

The worker compiles WebAssembly for:

- `openjpeg.wasm`: JPEG 2000 (JPXDecode)
- `jbig2.wasm`: JBIG2
- `qcms_bg.wasm`: ICC colour conversion, loaded with a synchronous same-origin XHR in the worker
- PostScript (Type 4) functions, which pdf.js compiles to WebAssembly at run time

With the production CSP, opening `issue3371.pdf` fetches `jbig2.wasm` and `openjpeg.wasm` and nothing else from `/pdfjs/wasm/`. When `'wasm-unsafe-eval'` was removed from the worker's CSP (by rewriting the response header in Playwright), every engine refused to compile the modules (Chromium and Firefox with a `CompileError`, WebKit with "Refused to create a WebAssembly object") and pdf.js fell back to `jbig2_nowasm_fallback.js` and `openjpeg_nowasm_fallback.js`. Those are much larger JavaScript decoders loaded with a dynamic `import()`, which is slower, but the page still rendered. So the keyword is needed for the intended path and is not needed for correctness.

Recommendation: keep `'wasm-unsafe-eval'` as the spec has it (§11.3).

Related:

- pdf.js 6.5.438 has no `isEvalSupported` option. The font-compiling `new Function` path behind CVE-2024-4367 was removed upstream, and neither `build/pdf.mjs` nor `build/pdf.worker.mjs` contains `eval` or `new Function`. `options.ts` therefore omits the option, and §10.3 can drop it.
- `getDocument` also takes `iccUrl`, for the CMYK profile in `iccs/`. The Vite plugin copies four directories (`cmaps`, `standard_fonts`, `wasm`, `iccs`), not three. It leaves out the QuickJS scripting sandbox (`quickjs-eval.js`, `quickjs-eval.wasm` and their licences). The service worker's precache list (Sprint 9) should include `wasm/` and `iccs/`.
- pdf.js 6 can render pages in a second worker (`pdf.renderer.mjs`). Bogey turns this off with `disableWorkerRendering: true`, since it would need a third script URL in the Trusted Types policy and buys nothing for one page at a time.

## 2. Font loading and Trusted Types raise no violations; WebKit's `<select>` does

- Embedded fonts load through the `FontFace` API with binary data, and standard fonts are fetched from `/pdfjs/standard_fonts/`. Neither raised a CSP or Trusted Types report in any engine.
- The only script-URL sink pdf.js touches on the main thread is the worker constructor, and the policy admits it. The JavaScript decoder fallbacks are loaded with `import()` inside the worker, which is not a Trusted Types sink and which `script-src 'self'` allows.
- **WebKit reports a `style-src-attr` violation whenever a native `<select>` element is created.** A bare `document.createElement('select')` on the empty app reproduces it, so the cause is WebKit's own shadow tree for the control, not pdf.js or React. The element still works, but the E2E fixture fails the test. The viewer's zoom menu therefore uses a menu button instead of a `<select>`. This matters for **Sprint 5**, whose spec (§7.1) uses `<select>` for dropdown and list fields, and for any settings control. The options are custom controls, or an exception in the violation fixture for this one WebKit report. That is the maintainer's decision.
- Playwright's `page.screenshot()` injects a `<style>` element into the page in WebKit, which WebKit reports as a `style-src-elem` violation. Tests that use the violation fixture should not take screenshots.

## 3. What `AnnotationMode.ENABLE_FORMS` leaves out

Measured in Chromium by rendering each fixture's first page with `ENABLE` and with `ENABLE_FORMS`, then counting non-white pixels inside each widget's rectangle. Fixtures: `acroform-all.pdf`, `fancy_fields.pdf`, `form_to_flatten.pdf`, `sample_form.pdf`, `libreoffice-form.pdf`, `fw9.pdf`.

| Widget | `ENABLE_FORMS` without `annotationCanvasMap` | `ENABLE_FORMS` with `annotationCanvasMap` |
| --- | --- | --- |
| Text (single-line, multiline, comb) | Left out | Left out |
| Read-only text | **Drawn** (it has its own canvas) | Left out |
| Dropdown and list | Left out | Left out |
| Checkbox and radio | **Drawn, with both the on and off appearance painted on top of each other** | Left out |
| Push button | Drawn | **Left out** |
| Signature field | Drawn (its appearance stays) | Drawn |
| Other annotations (stamps, comments) | Drawn | Drawn |

pdf.js draws every widget that "has its own canvas" (checkboxes, radio buttons, push buttons and read-only text) into a separate canvas when the caller passes `annotationCanvasMap`, and onto the page otherwise. Without the map, checkboxes and radio buttons come out wrong, since both states are drawn. With the map, push buttons disappear too. The spec wants button and signature appearances to stay visible (§7.1 draws only an outline over them).

What Sprint 1 does (`pdfjs/loader.ts`): on AcroForm documents it renders with `ENABLE_FORMS` and a map, then copies each push button's own canvas back onto the page at its rectangle. Signature fields stay on the page because pdf.js never separates them. The result, tested in all three engines in `apps/web/test/pdfjs.browser.test.ts`: text, read-only text, checkbox, radio, dropdown and list widgets are absent, and push buttons are present.

Sprint 5 should know that read-only text fields are also left out, so the field layer has to draw their values (F8).

## 4. Other findings

- **One worker, wrapped once.** Setting `GlobalWorkerOptions.workerPort` makes every document share one `PDFWorker`, and `PDFDocumentLoadingTask.destroy()` destroys that shared `PDFWorker`. Closing one document, or discarding a superseded open, would cut off the document on screen, and a `getDocument` during the destroy throws "the worker is being destroyed". The loader instead wraps its port in one long-lived `new PDFWorker({ port })` and passes it to every `getDocument` as `worker`, which pdf.js does not destroy with the task. It is still the `workerPort` mechanism the spec describes, with the same single same-origin worker.
- `PDFDocumentProxy` has no `destroy()` in 6.x; the loading task's `destroy()` frees the document.
- Password-protected files reject `getDocument` with a `PasswordException` whose `code` is `NEED_PASSWORD` (1) or `INCORRECT_PASSWORD` (2). The loader maps them to `pdf.password-required` and `pdf.password-wrong`, and each attempt loads a fresh copy of the bytes.
- `getViewport` applies `/UserUnit` itself, so zoom 1 at a viewport scale of 96/72 is physical size, as §5.1 defines.
