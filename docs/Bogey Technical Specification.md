# Bogey – Technical Specification

Status: Draft 2 · 2026-11-06 (wave 1 findings folded in)
Companion to: `docs/VISION.md` and `docs/REQUIREMENTS.md` (referred to below as "the vision" and "the requirements")

This document describes how Bogey is built: the repository layout, the boundary between the pure document library and the web application, the geometry model, form handling, overlays, signatures, export, persistence, the service worker, security, testing and release. Requirement IDs (D1, F3, X5 and so on) refer to the requirements. Where the requirements leave a choice open, this document makes one; where it departs from the requirements, the departure is listed in §16 with its reason so it can be confirmed or reversed. Appendix A maps every requirement ID to the section that satisfies it.

The structure, toolchain and security posture follow Mulligan (`../mulligan`), and anything not stated here should be done the way Mulligan does it.

---

## 1. Decisions taken

| Topic | Decision |
| --- | --- |
| Repository | pnpm workspace monorepo: `packages/core` (`@bogey/core`, pure, no DOM) and `apps/web` (`@bogey/web`), with the boundary enforced by tsconfig, dependency-cruiser and a boundaries test, as in Mulligan |
| Toolchain | Same as Mulligan: React 19, TypeScript 6.0.x strict, Vite 8, Vitest 5 (Node and browser mode), Playwright, ESLint 9, Prettier, dependency-cruiser, pnpm 12, Node 22+ |
| Rendering | `pdfjs-dist`, pinned to an exact version at scaffold time, canvas rendering only (no text layer, no annotation layer, no XFA layer, no scripting) |
| Reading and writing PDFs | `@cantoo/pdf-lib`, the maintained fork of pdf-lib with the same API plus password-based decryption. Upstream pdf-lib has not shipped since 2021 and cannot decrypt, which would break D3, E9 and acceptance test 1. Sprint 0 confirms decryption against the qpdf cipher matrix before anything depends on it (§9.6) |
| Where PDF parsing runs | pdf.js in its own worker; pdf-lib (enumeration on open, export) in a second worker through `comlink`, so a hostile or very large file cannot freeze the page |
| Network policy | `connect-src 'self'`, as the requirements specify. pdf.js fetches its standard fonts, CMaps and WASM decoders from the same origin, and the service worker fetches the app shell. Application code itself may not make network calls (lint-enforced), and the origin accepts only `GET`/`HEAD` with access logging off, so a same-origin request has nowhere to deliver data (§11.3) |
| Service worker | Yes (S8, B7): hand-written, about 150 lines, precache manifest generated at build. No Workbox |
| State | `zustand` stores outside components; edit history (undo/redo) implemented in core as a pure reducer |
| Persistence | `idb`, database `bogey`, with the original PDF bytes in their own object store so that the 500 ms autosave never rewrites a 50 MB record (§10.5, deviation from §9 of the requirements) |
| Encrypted documents | The original encrypted bytes are stored; the password never is. A restored encrypted document asks for its password again (§10.5) |
| On-screen text | Overlay text is shown in Liberation Sans (SIL OFL 1.1, self-hosted woff2, subset to WinAnsi), which is metrically compatible with Helvetica, so on-screen placement matches the exported Helvetica text to well under 1 pt |
| Signature capture | In-house Pointer Events canvas (about 200 lines) rather than `signature_pad`, because the pressure, coalesced-event and pen-versus-touch handling in G2 is most of what that library would do and its defaults would need overriding anyway |
| Infrastructure | One CloudFormation stack in us-east-1, copied from `mulligan/infra/mulligan.yaml`, serving `bogey.beta-site.us` |
| Deployment | From the maintainer's machine with `pnpm deploy:site`, as Mulligan does. CI runs the gate on pushes and pull requests but does not deploy. The GitHub Actions OIDC deploy (B6) goes to the backlog |
| License | GPL-3.0-or-later, matching Mulligan (pdf.js is Apache-2.0 and the pdf-lib fork is MIT, both compatible) |

---

## 2. Architecture overview

```
┌────────────────────────────────────────────────────────────────────────┐
│ apps/web  (React)                                                      │
│  UI ─ feature modules ─ zustand stores ─ persistence (idb) ─ SW client │
│     │                 │                          │                     │
│     │ calls           │ comlink RPC              │ workerPort          │
│     ▼                 ▼                          ▼                     │
│  ┌──────────────┐  ┌────────────────────────┐  ┌────────────────────┐  │
│  │ @bogey/core  │  │ pdf worker             │  │ pdf.js worker      │  │
│  │ geometry,    │  │  @bogey/core + pdf-lib │  │  (parse, render    │  │
│  │ model, undo, │  │  inspect, enumerate,   │  │   operator lists)  │  │
│  │ validation   │  │  export                │  │                    │  │
│  └──────────────┘  └────────────────────────┘  └────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
                        sw.js (app shell cache) sits in front of all of it
```

Three rules govern the layering:

1. **`@bogey/core` owns every decision about the document.** Coordinate conversion, the overlay and field-value model, undo, form-type detection, field enumeration, WinAnsi validation, the export recipe, signature pixel processing on raw RGBA buffers, snippet import validation and the output file name. It has no runtime dependency on the DOM, Canvas, Node built-ins, React or pdf.js. Its only runtime dependencies are the pdf-lib fork and `zod`.
2. **pdf.js is a display device.** The web app uses pdf.js to rasterize pages and to read page geometry for display. It never writes a PDF and never decides anything about fields; field structure comes from core (through pdf-lib), so there is one source of truth for field names, types and widget rectangles.
3. **The web app holds no document rules.** It turns pointer and keyboard input into core actions, renders the state that core's reducers produce, and draws widgets at the rectangles core's geometry returns.

### 2.1 How the boundaries are enforced

| Mechanism | Effect |
| --- | --- |
| `packages/core/tsconfig.json` sets `"lib": ["ES2022"]` and `"types": []` | Any reference to `document`, `HTMLCanvasElement`, `Buffer` or `fs` fails to compile. `Blob` is also unavailable, so core works on `Uint8Array` throughout |
| `package.json` `exports` on core exposes only `.` | No deep imports |
| dependency-cruiser rules in `pnpm lint` | `apps/web` reaches core runtime code only through `src/core-bridge/` and the pdf worker; `pdfjs-dist` may be imported only inside `src/pdfjs/`; core may not import `pdfjs-dist` or any workspace package |
| Core tests run in Node and in Chromium, Firefox and WebKit | Environment divergence (typed arrays, `structuredClone`, float formatting) is caught on every change |
| `tooling/test/boundaries.test.ts` | Proves each rule above rejects a planted violation, as Mulligan's does |

---

## 3. Repository layout

```
bogey/
├─ package.json                 # workspace scripts, devDependencies (same set as Mulligan, plus fast-check)
├─ pnpm-workspace.yaml          # packages/*, apps/*, tooling; allowBuilds allow-list
├─ tsconfig.base.json
├─ .dependency-cruiser.cjs
├─ eslint.config.js
├─ playwright.config.ts
├─ vitest.config.ts             # projects: core:node, core:chromium|firefox|webkit, web:jsdom, web:chromium, tooling:node
├─ deploy.env.example           # AWS profile, hosted zone, stack name (deploy.env itself is gitignored)
├─ CLAUDE.md
├─ docs/
├─ fixtures/                    # requirements Appendix A layout; manifest.json drives the tests
├─ infra/bogey.yaml             # CloudFormation stack (§11.7)
├─ scripts/
│  ├─ fetch-fixtures.sh         # Appendix A.3, SHA-256 verified
│  ├─ make-fixtures.ts          # Appendix A.4 (uses core + qpdf for the encrypted copy)
│  ├─ deploy.sh, infra-deploy.sh, load-deploy-env.sh
│  └─ check-live-headers.mjs
├─ packages/
│  └─ core/                     # @bogey/core
│     ├─ src/
│     │  ├─ index.ts            # public API (§4)
│     │  ├─ geometry/           # PageGeometry, conversions, rotation, widget rects (§5)
│     │  ├─ model/              # Overlay, FieldDescriptor, FieldValues, DocumentEditState, ids
│     │  ├─ history/            # edit reducer and undo/redo (§7.4)
│     │  ├─ inspect/            # form-type detection, field enumeration (§6)
│     │  ├─ text/               # Helvetica metrics, WinAnsi check, line layout, date formats
│     │  ├─ export/             # export recipe, JavaScript stripping, verification (§9)
│     │  ├─ image/              # signature pixel ops on RGBA buffers (§8)
│     │  ├─ snippets/           # JSON import/export schema and merge (§10.6)
│     │  └─ naming.ts           # output file name
│     └─ test/
├─ apps/
│  └─ web/                      # @bogey/web (§10)
└─ tooling/                     # fixture manifest checks, infra/headers equality, boundaries test
```

---

## 4. Core public API (`@bogey/core`)

Synchronous and pure unless marked `async`. Functions that take PDF bytes run in the pdf worker in the web app and directly in Node in tests. Core never throws for bad input: it returns `Result<T>` with typed problems. It throws only on programmer error.

```ts
type Result<T, E = Problem> = { ok: true; value: T } | { ok: false; problems: E[] };

// ── Geometry (§5) ─────────────────────────────────────────────
export function pageGeometry(raw: { mediaBox: Box; cropBox?: Box; rotate?: number; userUnit?: number }): PageGeometry;
export function viewSize(page: PageGeometry, zoom: number): { width: number; height: number };   // CSS px
export function pdfToScreen(page: PageGeometry, pt: Point, zoom: number): Point;
export function screenToPdf(page: PageGeometry, px: Point, zoom: number): Point;
export function pdfRectToScreen(page: PageGeometry, rect: Box, zoom: number): ScreenRect;
export function widgetScreenRect(page: PageGeometry, widget: WidgetGeometry, zoom: number): ScreenRect & { rotation: 0 | 90 | 180 | 270 };
export function screenDeltaToPdf(page: PageGeometry, d: Point, zoom: number): Point;   // for drag and arrow-key nudges
export function snapToGrid(pt: Point, grid?: number): Point;                           // O9, default 1 pt

// ── Inspection (§6) ───────────────────────────────────────────
export async function inspectPdf(bytes: Uint8Array, opts?: { password?: string }): Promise<Result<PdfInfo, InspectProblem>>;
//   PdfInfo = { formType, xfa: 'none' | 'hybrid' | 'dynamic', encrypted, pageCount, pages: PageGeometry[],
//               fields: FieldDescriptor[], initialValues: FieldValues, metadata: { title?, author? } }

// ── Editing (§7) ──────────────────────────────────────────────
export function createEditState(info: PdfInfo): DocumentEditState;
export function applyEdit(state: DocumentEditState, edit: Edit, ctx: EditContext): DocumentEditState;   // pure; ctx = fields and page count, for validation
export function createHistory(state: DocumentEditState, opts?: { limit?: number }): History;
export function historyApply(h: History, edit: Edit, ctx: EditContext, opts?: { coalesceKey?: string }): History;
export function undo(h: History): History;
export function redo(h: History): History;

// ── Text (§7.2) ───────────────────────────────────────────────
export const TEXT: { lineHeightFactor: 1.2; minSize: 6; maxSize: 36; defaultSize: 10 };
export function layoutText(text: string, size: number, bold: boolean): { lines: string[]; width: number; height: number };
export function nonWinAnsi(text: string): string[];                 // distinct offending characters
export function formatDate(d: { y: number; m: number; d: number }, fmt: DateFormat): string;

// ── Signatures (§8) ───────────────────────────────────────────
export function removeNearWhite(rgba: Uint8ClampedArray, w: number, h: number, threshold: number): void;  // in place
export function alphaBounds(rgba: Uint8ClampedArray, w: number, h: number, pad: number): Rect | null;

// ── Export (§9) ───────────────────────────────────────────────
export async function exportPdf(input: ExportInput, onStage?: (s: ExportStage) => void | Promise<void>): Promise<Result<ExportOutput, ExportProblem>>;
export async function exportPageImages(input: ExportPageImagesInput): Promise<Result<ExportOutput, ExportProblem>>;   // §9.5; pages rendered by the app
export function preflightExport(state: DocumentEditState, fields: FieldDescriptor[]): ExportWarning[];   // E4
export function outputFileName(originalName: string): string;      // D8

// ── Snippets (§10.6) ──────────────────────────────────────────
export function parseSnippetFile(text: string): Result<SnippetFileV1>;
export function serializeSnippets(snippets: Snippet[]): string;
export function planSnippetMerge(existing: Snippet[], incoming: SnippetFileV1): { added: Snippet[]; overwritten: Snippet[]; unchanged: number };
```

### 4.1 Core types

```ts
type Box = [x0: number, y0: number, x1: number, y1: number];      // PDF points, normalized so x0 < x1, y0 < y1
type Point = { x: number; y: number };

interface PageGeometry {
  index: number;                 // 0-based
  view: Box;                     // crop box intersected with media box (what readers display)
  rotate: 0 | 90 | 180 | 270;    // /Rotate normalized to [0, 360) and to a multiple of 90
  userUnit: number;              // /UserUnit, default 1
}

type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature';

interface FieldDescriptor {
  name: string;                  // fully qualified name; the key into FieldValues
  kind: FieldKind;
  supported: boolean;            // false for button and signature (F1: shown as read-only outlines)
  readOnly: boolean;
  required: boolean;
  multiline?: boolean; comb?: boolean; maxLength?: number; password?: boolean;   // text
  options?: { value: string; label: string }[];   // dropdown, list
  editable?: boolean; multiSelect?: boolean;      // dropdown (combo with edit flag), list
  onValues?: string[];           // checkbox on-state names, radio options
  fontSize: number;              // from /DA; 0 means auto
  textAlign: 'left' | 'center' | 'right';          // /Q
  widgets: WidgetGeometry[];     // one per widget annotation, in document (tab) order
  tabOrder: number;              // F6: page index, then the page's /Tabs order, then widget order in /Annots
}

interface WidgetGeometry { page: number; rect: Box; mkRotation: 0 | 90 | 180 | 270; onValue?: string }

type FieldValue = string | boolean | string[];
type FieldValues = Readonly<Record<string, FieldValue>>;    // always accessed through Object.hasOwn

interface DocumentEditState {
  fieldValues: FieldValues;      // overrides only: fields the user changed (§6.3)
  overlays: readonly Overlay[];
}
```

`Overlay` is the union from the requirements (§9 there), with one clarification about the anchor on rotated pages, given in §5.3.

---

## 5. Geometry

Written and tested first (X1). It lives in `packages/core/src/geometry/`, which satisfies X1's "pure functions, no DOM" with a different path than the requirements name (§16).

### 5.1 Coordinate spaces

| Space | Origin | Units | Used by |
| --- | --- | --- | --- |
| PDF user space | Bottom-left of the unrotated page; `view` box may not start at (0, 0) | Points (1/72 in) × `userUnit` | Stored overlays, widget `/Rect`, pdf-lib drawing |
| View space | Top-left of the page as displayed (after `/Rotate`) | CSS px | Overlay and widget positioning, pointer events |
| Device space | Top-left of the canvas | Device px | Canvas backing store only (CSS px × render scale) |

Zoom 1.0 is 100%, defined as physical size: `k = zoom × (96 / 72) × userUnit`, so one point is 4/3 CSS px at 100% on a page with the default `userUnit` of 1. This matches pdf.js's `PDF_TO_CSS_UNITS` and Acrobat's 100%. Fit-width and fit-page are resolved to a numeric zoom by the web app from the container size and `viewSize(page, 1)`.

### 5.2 Conversion

With `view = [vx0, vy0, vx1, vy1]`, `W = vx1 − vx0`, `H = vy1 − vy0`, and `k` as above, a PDF point `(x, y)` maps to view space as follows. The table is the whole of `pdfToScreen`; `screenToPdf` solves the same equations for `(x, y)`.

| `/Rotate` | Screen size | `u` (CSS px from left) | `v` (CSS px from top) |
| --- | --- | --- | --- |
| 0 | `W·k × H·k` | `(x − vx0)·k` | `(vy1 − y)·k` |
| 90 | `H·k × W·k` | `(y − vy0)·k` | `(x − vx0)·k` |
| 180 | `W·k × H·k` | `(vx1 − x)·k` | `(y − vy0)·k` |
| 270 | `H·k × W·k` | `(vy1 − y)·k` | `(vx1 − x)·k` |

`/Rotate` is clockwise, as in the PDF specification. Values that are not multiples of 90 are treated as 0, the way pdf.js treats them. These formulas reproduce pdf.js's `PageViewport` transform, and a property test asserts agreement with `PageViewport.convertToViewportPoint` for random geometry, so the canvas and the overlays cannot drift apart (§14.3).

Rectangles convert by mapping two opposite corners and normalizing. `screenDeltaToPdf` applies only the rotation and scale, without the offset, and is what drag and arrow-key nudges use, so "arrow right" moves an overlay right on screen whatever the page rotation (O7).

### 5.3 Overlay anchor convention on rotated pages

The requirements store `(x, y)` in unrotated PDF space and leave rotation to the geometry module. To make that unambiguous for text and images on rotated pages, every overlay is defined in the **upright frame**, which is the page as the user sees it:

- `(x, y)` is the overlay's visual anchor (baseline-left of the first line for text and dates, bottom-left of the box for checks and signatures), converted into unrotated PDF coordinates.
- `width`, `height` and text direction are measured in the upright frame.
- On export, the overlay is drawn at `(x, y)` with `rotate: degrees(page.rotate)`. pdf-lib rotates counterclockwise about the anchor, and the derivation from §5.2 shows that the upright frame's "right" in PDF space is +x, +y, −x and −y for rotations 0, 90, 180 and 270, which is exactly a counterclockwise rotation by the page's `/Rotate`. Text placed on a rotated page therefore reads upright on screen and in every reader.

### 5.4 Widget rectangles

`widgetScreenRect` converts a widget's `/Rect` with §5.2 and also returns the net on-screen rotation of the widget's content, `(page.rotate − mkRotation) mod 360` clockwise, where `mkRotation` is `/MK /R` (counterclockwise in page space). The web app rotates the HTML input with a CSS transform by that amount. For nearly all real forms, `/MK /R` equals the page rotation and the net rotation is 0.

### 5.5 Precision

All arithmetic is in doubles; nothing is rounded except by `snapToGrid`, which rounds the stored anchor to the nearest 1 pt (O9) when an overlay is created or moved. `screenToPdf(pdfToScreen(p))` returns `p` within 1e-9 pt in property tests, well inside X2's exactness and X5's 0.01 pt bound. Device-pixel rounding happens only on the canvas, never in stored coordinates.

---

## 6. Opening and inspection

### 6.1 Open sequence

1. **Accept** (D1, D2). The drop zone and the file picker hand over a `File`. Anything over 50 MB is refused before it is read. Type is decided by content: the first 1,024 bytes must contain `%PDF-`, which is how readers find the header, whatever the extension or reported MIME type.
2. **Read** into a `Uint8Array` with `File.arrayBuffer()`.
3. **Persist** (D5): a new document id is created and the bytes are written to IndexedDB before anything else, so a crash during parsing still leaves the file recoverable.
4. **Inspect** in the pdf worker: `inspectPdf(bytes)`. If it reports `encrypted` with a password needed, the password dialog opens (D3); each attempt calls `inspectPdf(bytes, { password })` and pdf.js `getDocument({ password })` in parallel, and the dialog stays open on `INCORRECT_PASSWORD` until the user succeeds or cancels. Cancel deletes the just-created record and returns to the empty state. The password is held only in the in-memory document session (§10.4).
5. **Load for display**: pdf.js `getDocument` with the options in §10.3, on a copy of the bytes (`bytes.slice()`), because pdf.js transfers its buffer to its worker and leaves the caller's detached.
6. **Thumbnail**: page 1 is rendered at 200 px wide into an `OffscreenCanvas` (or a detached canvas on browsers without it), encoded to PNG and stored on the record.
7. **Notices** for XFA (§6.2) and for any page count over 300 (rendering will be slow on iPad).

### 6.2 Form-type detection (D4)

`inspectPdf` classifies the document from the catalog and the AcroForm dictionary:

| Catalog state | `xfa` | `formType` | Behavior |
| --- | --- | --- | --- |
| No `/AcroForm`, or no terminal fields with widgets | `none` | `flat` | Overlays only |
| `/AcroForm` with widgets, no `/XFA` | `none` | `acroform` | Fields plus overlays |
| `/AcroForm /XFA` present **and** AcroForm widgets with appearance streams exist | `hybrid` | `acroform` | Notice: "This form also carries an Adobe XFA layer. Bogey fills its standard fields instead; the XFA layer is removed from the downloaded copy." Export calls `form.deleteXFA()` |
| `/XFA` present and no usable widgets, or `/NeedsRendering true` | `dynamic` | `xfa` | The D4 notice, and the page is treated as flat |

Inspection loads with `preserveXFA: true`: the pdf-lib fork otherwise deletes the XFA entry the first time `getForm()` runs, saving included, so without it no document would ever look like XFA (found in Sprint 0). Export loads without it for hybrid forms, which is the removal described above.

The hybrid case departs from D4's "treat as flat" (§16). Hybrid forms, which include many government forms produced from LiveCycle as static XFA, carry a complete AcroForm copy of every field, and filling it gives a better result than typing over it; removing the XFA stream on export stops Acrobat from preferring the stale XFA data over the filled values. A dynamic XFA form usually renders in non-Adobe readers as a single placeholder page ("Please wait… this document requires Adobe Reader"); in that case the notice adds that what is visible is the placeholder, so the user is not left wondering where the form went.

### 6.3 Field enumeration (F1)

`inspectPdf` walks `form.getFields()` and builds a `FieldDescriptor` per terminal field from the pdf-lib class: `PDFTextField` → `text`, `PDFCheckBox` → `checkbox`, `PDFRadioGroup` → `radio`, `PDFDropdown` → `dropdown`, `PDFOptionList` → `list`, `PDFButton` → `button`, `PDFSignature` → `signature`. Flags come from the field's accessors (`isReadOnly`, `isRequired`, `isMultiline`, `isCombed`, `getMaxLength`, `isEditable`, `isMultiselect`, `getOptions`), and `fontSize` and `textAlign` from `/DA` and `/Q`.

Each widget is assigned to a page by its `/P` entry where present and otherwise by finding it in a page's `/Annots` array, since `/P` is optional and often missing. Widgets found on no page are dropped. Tab order (F6) is page index, then the page's `/Tabs` order (`/S` structure order is treated as row order, which is what most readers do in practice), then position in `/Annots`.

**Values held as overrides.** `initialValues` records what the PDF already contains, and `DocumentEditState.fieldValues` holds only values the user has changed. The display shows `override ?? initial`. Export sets only overridden fields, so pdf-lib regenerates appearances for those fields only, and untouched pre-filled fields keep their original appearance, including any non-Helvetica fonts the form author used.

Value shapes: text and single-choice dropdown → `string`; checkbox → `boolean` (on means the widget's first on-value; a checkbox field with several widgets and distinct on-values is a radio-like group and is described as `radio`); radio → the selected option `string`, or `''` for none; list → `string[]`.

---

## 7. Editing

### 7.1 Field widgets (F2–F8)

The web app renders one real HTML control per supported widget, absolutely positioned at `widgetScreenRect`, inside a layer that sits over the page canvas and scales with zoom (F2):

| Kind | Control |
| --- | --- |
| text | `<input>` or, when multiline, `<textarea>`; `maxLength` applied (F4); comb fields use letter-spacing of `rect width / maxLength` and a monospaced cell layout so each character sits in its box; `password` fields use `type="password"` on screen and are exported as typed |
| checkbox | `<input type="checkbox">` sized to the widget |
| radio | `<input type="radio" name={fieldName}>` per widget, value = widget on-value (F5) |
| dropdown | `<select>`; editable combos use `<input list>` with a `<datalist>` |
| list | `<select multiple={multiSelect} size>` |
| button, signature | A dashed outline with an accessible label, not focusable (F1) |

Read-only fields render the same controls with `readOnly` or `disabled` (F8). Font size on screen is `fontSize × k`; when `/DA` gives 0 (auto), core's `layoutText` computes the size pdf-lib's appearance generator would choose for the current value, so the on-screen text matches the export. Every control has `aria-label` set to the field's alternate name (`/TU`) when present and otherwise its partial name (U4). DOM order follows `tabOrder`, so Tab and Shift+Tab walk the form in document order across pages that are mounted (F6); tabbing past the last field on a page moves to the next page.

Input events dispatch `setField` edits immediately (F3). Persistence is debounced (§10.5).

The **Fields panel** (F7) lists every field by name in tab order with its kind and current value, filterable by name. Selecting a row navigates to the page, scrolls the widget into view and focuses it.

### 7.2 Free overlays (O1–O9)

Tools: select (V), text (T), check (C), date (D), signature (S). In a placement tool, a click or tap on the page creates the overlay at `snapToGrid(screenToPdf(point))` and the tool reverts to select (O2). A "tap" is a pointerdown–pointerup pair with under 6 CSS px of movement within 400 ms, so a pan gesture on iPad never places anything.

**Text and date** (O3, O5). Edited in a `<textarea>` with no border, auto-sized to `layoutText`. Enter commits, Shift+Enter inserts a line break, Esc commits and leaves edit mode. Line height is `1.2 × size` both on screen and in export, and export draws each line separately, so line spacing is identical in both. Size is 6–36 pt (default from settings, 10 pt), with a bold toggle. A date overlay is a text overlay that starts with today in the configured format and keeps `type: 'date'` so it can be found and restyled later.

The on-screen baseline is placed from the font's own metrics: Liberation Sans has `ascender 0.905`, `descender 0.212` in `hhea`, so with line height `L` and size `s`, the first baseline sits `(L − 1.117·s)/2 + 0.905·s` below the top of the box. The constants live in `apps/web/src/features/overlays/textMetrics.ts`, and a Playwright test measures the rendered glyph position against the exported text position (§14.5).

**Check** (O4). The ✓ glyph is ZapfDingbats `a20` (U+2714 in pdf-lib's ZapfDingbats encoding); the X is drawn as two stroked lines rather than a glyph, so it is identical on screen (SVG) and in export (`drawLine`). Sizes 8–24 pt. On screen the ✓ is an SVG path taken from the glyph outline, so no Dingbats font needs to be installed.

**Signature** (O6). Placed from the library at 150 pt wide with the stored aspect ratio, which stays locked when resizing.

**Manipulation** (O7). A selected overlay shows a frame with a move area (the overlay body) and a single resize handle at the bottom-right. Handles are 44 × 44 CSS px on coarse pointers (`@media (pointer: coarse)`) and 12 × 12 elsewhere, with the visible dot smaller than the hit area. Resize changes font size for text and dates (in whole points), size for checks, and width with locked aspect for signatures. Arrow keys nudge 1 pt, Shift+Arrow 10 pt, in screen directions. Delete and Backspace remove the selected overlay when focus is not in a text control; a delete button sits on the frame.

**Snippets and the last position** (N2). A pointerdown on the page in select mode records `lastPoint = { page, pdfPoint }`. Snippet placement uses `lastPoint`, or 36 pt in from the top-left of the current page's view box when there is none.

### 7.3 Edits

```ts
type Edit =
  | { type: 'setField'; name: string; value: FieldValue }
  | { type: 'addOverlay'; overlay: Overlay }
  | { type: 'updateOverlay'; id: string; patch: Partial<OverlayProps> }
  | { type: 'moveOverlay'; id: string; x: number; y: number }
  | { type: 'deleteOverlay'; id: string };
```

`applyEdit` validates every edit (known field name, value shape matching kind, read-only fields rejected, overlay sizes clamped to their ranges, page index in range) and returns the state unchanged for an invalid edit. Field names are looked up with `Object.hasOwn` against the descriptor list, so a field named `__proto__` in a hostile PDF cannot reach the prototype.

### 7.4 Undo and redo (O8)

`History` holds `past`, `present` and `future` arrays of immutable `DocumentEditState` snapshots. Snapshots share structure (unchanged overlays and the field map are reused by reference), so 100 steps of a typical document cost a few hundred kilobytes. The limit is 100 steps, above the required 50.

Coalescing keeps the history meaningful: typing into one field or one text overlay is a single step per focus session (`coalesceKey = field name` until blur, or 1 s of idle), a drag is one step on pointerup, and keyboard nudges coalesce per overlay for 1 s. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (and Ctrl+Y on Windows) act on Bogey's history when focus is anywhere except a native text control; inside a field or textarea, the browser's own undo runs first, and Bogey's history takes over once the control is blurred.

History is per document and in memory. It is not persisted, so after a reload the restored state is the new baseline with nothing to undo (§16).

---

## 8. Signatures (G1–G6)

### 8.1 Drawing (G2, G3)

The draw dialog contains a canvas at least 600 × 200 CSS px (full dialog width on iPad, up to 900 × 300), with backing store at `devicePixelRatio`. It has `touch-action: none` and listens only to `pointerdown`, `pointermove`, `pointerup` and `pointercancel`, calling `setPointerCapture` on down.

- Stroke width: for `pointerType === 'pen'`, `1.5 + 2.5 × pressure` CSS px (so 1.5–4 px); for mouse and touch, a constant 2.5 px. A pen with `pressure === 0` on move (some drivers report 0 while hovering with a button down) uses 0.5.
- Sampling: `getCoalescedEvents()` where available (Chrome, Edge, Firefox, recent Safari), which gives the full 240 Hz Pencil sample rate instead of one point per frame.
- Smoothing: quadratic Bézier through segment midpoints, with each segment's width interpolated from its endpoints, drawn incrementally so latency stays at one frame.
- Palm handling: iPadOS rejects the palm when the Pencil is active. In addition, while a pen stroke is in progress, `touch` pointers are ignored, which costs nothing and catches the wrist that lands just before the pencil.
- Hover: pen events with `buttons === 0` are ignored.
- Buttons: Clear, Cancel, Save, plus a name field (default "Signature" or "Initials" from the kind toggle).

On Save, the canvas pixels are read with `getImageData`, `alphaBounds(…, pad = 8 × dpr)` finds the trimmed box (G3), and the cropped region is encoded with `canvas.toBlob('image/png')`. An empty canvas cannot be saved.

### 8.2 Uploading (G4, S9)

Accepted inputs are whatever `createImageBitmap` decodes: PNG, JPEG, WebP everywhere and HEIC in Safari. Files over 20 MB are refused; the bitmap is decoded with `imageOrientation: 'from-image'` and, if its long edge exceeds 2,000 px, drawn scaled to 2,000 px straight after decoding (the size is only known once decoded, so a resize during decode would need a second decode; peak memory is about the same), which bounds memory and is still about 6× the resolution needed for a 150 pt signature at print quality.

`removeNearWhite` uses Rec. 709 luminance, `0.2126 R + 0.7152 G + 0.0722 B`. Pixels at or above the threshold become fully transparent; pixels within 16 levels below it get a proportional alpha, which removes the hard, jagged fringe that a single cut-off leaves around anti-aliased ink. The threshold slider covers 180–250 (default 235). The dialog previews the result on a checkerboard, updating on slider input with the work done on a downscaled copy for responsiveness and on the full image at Save. The result is trimmed with `alphaBounds` and stored as a new PNG; the uploaded file's bytes are discarded, which strips EXIF and any other metadata (S9).

### 8.3 Library (G1, G5)

Signatures are stored as `{ id, name, kind, png: ArrayBuffer, width, height, createdAt }` (G1). The Signatures panel lists thumbnails grouped by kind; clicking one enters place-signature mode (G5), and each item has rename and delete actions. Deleting a signature that is placed in a document asks first; the placed overlays keep working until the next export, which fails with a message naming the affected pages if the image is gone. To avoid that, export reads signature images from the library at export time and the overlay picker marks overlays whose signature has been deleted.

---

## 9. Export (E1–E9)

### 9.1 Pipeline

`exportPdf` runs in the pdf worker. Input: the original bytes (E1, always the stored original and never a previous export), the password if any, `PdfInfo`, `DocumentEditState`, the signature PNGs referenced by overlays, and options (replace non-WinAnsi characters, today's date for metadata).

1. Load with `PDFDocument.load(bytes, { password, updateMetadata: false })`.
2. **Fields** (E2), for `formType === 'acroform'`:
   1. If `xfa === 'hybrid'`, `form.deleteXFA()`.
   2. For each overridden field, call the typed setter (`setText`, `check`/`uncheck`, `select`, `clear`). Read-only fields are never set.
   3. **Appearance check**: any field whose widgets lack an appearance stream for their current value (common in forms that set `/NeedAppearances true` and rely on the reader) is marked dirty, so that the next step generates one. Without this, `flatten()` drops those fields' visible content.
   4. `form.updateFieldAppearances(helvetica)`, then `form.flatten()`, then remove `/NeedAppearances`.
3. **Overlays** (E3), after flattening so they sit above field content. Fonts (`Helvetica`, `Helvetica-Bold`, `ZapfDingbats`) are embedded on first use. Each signature PNG is embedded once per document with `embedPng` and reused for every placement (G6, E5). Text is drawn line by line at `y − i × 1.2 × size` in the upright frame (§5.3), rotated by the page rotation.
4. **Active content** (`export/hygiene.ts`, hardened through five security-review rounds in Sprint 2). Policy:
   - Every action, wherever it lives (`/OpenAction`, catalog and page `/AA`, annotation `/A` and `/AA`, the `/Outlines` tree), is kept only if it is `GoTo`, or `URI` whose decoded target is an absolute `http:`, `https:` or `mailto:` URL. Unsafe actions are spliced out of `/Next` chains so a safe remainder survives.
   - `/OpenAction` keeps only `GoTo` or a destination array, never `URI`, and its final chain is re-checked strictly at the end; anything else removes it.
   - All `/AA` entries and the `/Names /JavaScript` tree are removed.
   - Annotations are kept only if passive (Text, Link, FreeText, Line, Square, Circle, Polygon, PolyLine, Highlight, Underline, Squiggly, StrikeOut, Stamp, Caret, Ink, Popup, FileAttachment with actions stripped, Widget); 3D, RichMedia, Screen, Movie, Sound and unknown subtypes are removed. Embedded files stay.
   - Cleaning fails closed and is bounded: shared action objects are copied per policy rather than edited in place (memoized, budget of 10,000 copies), result lists are de-duplicated and capped at 256 entries (over the cap, the slot keeps nothing), and an outline over 64 levels or 100,000 items is removed whole.

   After flattening, form calculation and validation scripts have no fields to act on, and the remaining scripts in typical forms ("this form must be opened in Adobe Reader", print-on-open, field resets) can only misbehave in the recipient's reader. This is not in the requirements (§16).
5. **Metadata** (E8): title and author are kept; `Producer` is set to `Bogey`; `ModDate` is set to now. The XMP metadata stream, if present, is left alone except for the same fields where it can be updated in place.
6. **Encryption** (E9): the output is saved without encryption. The export dialog states this before the user confirms ("The original was password-protected. The downloaded copy will not be.").
7. Save with `{ useObjectStreams: true }` (E6).
8. **Verification**: the output is loaded again with pdf-lib and must have the same page count, no AcroForm fields, no encryption, and every overlay's page present. Failure returns an `ExportProblem` and nothing is downloaded.

The result is transferred (not copied) back to the main thread, wrapped in a `Blob` of type `application/pdf`, and downloaded through an anchor with `download = outputFileName(name)` (D8). The blob URL is revoked 60 s later, since Safari reads it asynchronously after the click. On iPadOS, Safari shows its download prompt and saves to Files, which E6 accepts.

### 9.2 Preflight (E4)

`preflightExport` runs before step 1 and lists every text overlay, date overlay and overridden text field containing characters outside WinAnsi (Windows-1252), naming the overlay or field, its page, and the offending characters. If the list is non-empty, the export dialog shows it with "Replace with ? and download" and "Cancel". Field values are checked as well as overlays, because `updateFieldAppearances` with Helvetica fails on the same characters.

### 9.3 Progress and performance (E7)

The export dialog shows an indeterminate progress indicator once export has run for 500 ms, and the worker reports stage names (Loading, Filling fields, Drawing, Saving, Checking). The budget is 5 s for the 20-page, 10 MB fixture on a 2020-era laptop; a Playwright performance test asserts 10 s on CI hardware (CI runners are slower and shared), and the 5 s figure is checked by hand on the reference machine at each milestone. A 60 s timeout terminates and replaces the worker and reports the failure.

### 9.4 Output file name

`outputFileName` strips the final `.pdf` (case-insensitive), removes path separators, control characters and characters Windows forbids (`<>:"/\|?*`), trims trailing dots and spaces, caps the stem at 120 characters, falls back to `document` if nothing is left, and appends `-signed.pdf`.

### 9.5 Encrypted originals that fail to decrypt

If the pdf-lib fork cannot load a document that pdf.js opened with the same password (an unusual cipher or a damaged security handler), the export falls back to the approach in the vision: each page is rendered by pdf.js at 200 dpi, embedded as a JPEG page image in a new document, and overlays and field values are drawn on top. The dialog says that the result is an image of each page, without selectable text, and asks before continuing.

### 9.6 Decryption (Sprint 2 spike, now a standing test)

`tooling/test/fixtures-decryption.test.ts` loads every encrypted fixture with `@cantoo/pdf-lib`, fills and flattens a field where there is one, exports, and checks the output with pdf-lib (no `/Encrypt` anywhere) and pdf.js text extraction. Full results are in `docs/spikes/S2-decryption.md`. Every cipher in the qpdf matrix passes: RC4-40, RC4-128, AES-128, AES-256 R5 and R6, with user and owner-only passwords. The one failure is pdf.js's `crypt_filters.pdf` (mixed crypt filters), which loads without error but decrypts to garbage; a capability check in `inspectPdf` (no remaining `/Crypt` filters, first three pages' content streams readable) marks such files `decryptable: false`, `exportPdf` returns `export.cannot-decrypt`, and the app uses `exportPageImages` (§9.5).

Three fixes came out of the spike: export removes leftover cross-reference streams and unparsed objects that still name `/Encrypt`; non-ASCII AES-256 R5 passwords are retried as UTF-8 (the fork encodes them as Latin-1); and the "no pages, so damaged" check runs after decryption, since some files keep their page tree in an encrypted object stream.

Open: if pdf.js accepts a password the fork rejects (no fixture does), core reports `pdf.password-wrong`. The open flow should treat "pdf.js accepted, core rejected" as `decryptable: false` and use page images (assigned to Sprint 6, which owns encrypted restore).

---

## 10. Web application (`apps/web`)

### 10.1 Stack

| Concern | Choice |
| --- | --- |
| Framework | React 19, function components, TypeScript strict |
| Build | Vite; hashed assets; workers via `new Worker(new URL(…), { type: 'module' })` |
| State | `zustand` |
| Worker RPC | `comlink` |
| Persistence | `idb` |
| Snippet reordering (N3) | `@dnd-kit/core` and `@dnd-kit/sortable`, for keyboard and screen-reader reordering, as Mulligan uses |
| Validation | `zod` (in core), run with `jitless: true` because the CSP forbids `new Function` |
| Styling | CSS Modules with Mulligan's design tokens; light and dark follow `prefers-color-scheme` (U3) |
| Fonts | Liberation Sans Regular and Bold, woff2, WinAnsi subset, self-hosted |
| Tests | Vitest + React Testing Library (jsdom); Vitest browser mode for rendering; Playwright end-to-end |

Beyond the requirements' list in B2, the additions are `zustand`, `comlink`, `zod` and `@dnd-kit`, each already used and reviewed in Mulligan (§16).

### 10.2 Source layout

```
apps/web/src/
├─ main.tsx, App.tsx
├─ config.ts                 # app limits and timings (§11.8)
├─ security/
│  ├─ headers.json           # the one definition of production headers (§11.3)
│  └─ trustedTypes.ts        # default policy: script URLs for the two workers and sw.js only
├─ core-bridge/              # the only runtime importer of @bogey/core on the main thread
├─ pdfjs/                    # the only importer of pdfjs-dist: loader, render queue, thumbnails
├─ workers/
│  └─ pdf.worker.ts          # hosts @bogey/core: inspectPdf, exportPdf (comlink)
├─ state/
│  ├─ document.ts            # active document: info, history, password (memory only)
│  ├─ view.ts                # page, zoom, tool, selection, lastPoint
│  ├─ library.ts             # signatures, snippets, settings
│  ├─ persistence.ts         # idb schema, migrations, write queue, clear (§10.5)
│  └─ session.ts             # controller keeping stores and IndexedDB in step
├─ sw/
│  ├─ sw.ts                  # service worker source, built to /sw.js (§11.5)
│  └─ register.ts            # registration and the update toast
├─ features/
│  ├─ open/                  # DropZone, RecentDocuments, PasswordDialog
│  ├─ viewer/                # PageView, PageCanvas, Thumbnails, ZoomControls, gestures
│  ├─ fields/                # FieldLayer, FieldControl, FieldsPanel
│  ├─ overlays/              # OverlayLayer, TextOverlay, CheckOverlay, SignatureOverlay, SelectionFrame, textMetrics
│  ├─ signatures/            # SignaturesPanel, DrawDialog, UploadDialog, pointer capture
│  ├─ snippets/              # SnippetsPanel, import/export
│  ├─ export/                # ExportDialog, download
│  └─ pages/                 # Help (shortcuts), About, Privacy (U2, U5)
└─ ui/                       # Button, Dialog, Tabs, Toast, Banner, ErrorBoundary
```

### 10.3 pdf.js integration

- **Worker**: one module worker, `new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })`, wrapped once in a long-lived `new PDFWorker({ port })` that every `getDocument` receives as `worker`. Setting `GlobalWorkerOptions.workerPort` instead makes `loadingTask.destroy()` destroy the shared worker, which cuts off the document on screen when another is closed or superseded. Vite bundles the worker as a hashed same-origin asset (S5), and the Trusted Types policy admits exactly that URL pattern. `disableWorkerRendering: true` keeps pdf.js 6 from starting a second rendering worker.
- **`getDocument` options**: `data` (a copy), `password`, `enableXfa: false`, `standardFontDataUrl: '/pdfjs/standard_fonts/'`, `cMapUrl: '/pdfjs/cmaps/'`, `cMapPacked: true`, `wasmUrl: '/pdfjs/wasm/'`, `iccUrl: '/pdfjs/iccs/'`, `useSystemFonts: false`, and `disableFontFace: false`. A Vite plugin (`apps/web/plugins/pdfjsAssets.ts`) copies those four directories out of `pdfjs-dist` into the build at `/pdfjs/`, leaving out the QuickJS scripting sandbox. pdfjs-dist 6.5.438 has no `isEvalSupported` option: the font-compiling `new Function` path behind CVE-2024-4367 (arbitrary JavaScript from a crafted font, pdf.js before 4.2.67) was removed upstream, and neither build file contains `eval` or `new Function`.
- **WebAssembly**: pdf.js 6.5.438 compiles WebAssembly for JPEG 2000, JBIG2, ICC colour conversion and PostScript (Type 4) functions, so `'wasm-unsafe-eval'` stays in the CSP. Without it every engine refuses the modules and pdf.js falls back to much larger, slower JavaScript decoders (Sprint 1 spike, `docs/spikes/S1-pdfjs.md`).
- **Annotation mode**: pages of `acroform` documents render with `AnnotationMode.ENABLE_FORMS` **and an `annotationCanvasMap`**; without the map, pdf.js paints checkboxes and radio buttons with both their on and off appearances on top of each other. With the map, text (including read-only), checkbox, radio, dropdown and list widgets are left out of the canvas, signature fields stay, and push buttons are also left out, so the loader copies each push button's own canvas back onto the page at its rectangle. Bogey's field layer therefore draws every value, read-only ones included (F8). Other annotations (stamps, comments) still render. `flat` and `xfa` documents render with `AnnotationMode.ENABLE`.
- **Render scale**: `k × devicePixelRatio`, capped so that one canvas never exceeds 16,777,216 pixels (iOS Safari's per-canvas limit). Above the cap, the canvas renders at the cap and CSS scales it up, which looks slightly soft at very high zoom on large pages and is better than a blank canvas.
- **Render queue**: at most two concurrent page renders; a render that is no longer needed is cancelled with `renderTask.cancel()`. During a zoom change the existing canvas is scaled with a CSS transform until the new render completes.
- **Memory** (V6): the current page and its two neighbors have full canvases; other pages hold no canvas. Released canvases are set to 0 × 0 before being dropped, since WebKit frees backing stores reliably only that way. `page.cleanup()` runs for pages more than five away.
- **Thumbnails** (V2): rendered at 120 CSS px wide when they scroll into view (IntersectionObserver), kept as `ImageBitmap`s with an LRU of 60 entries.

### 10.4 Screens and interaction

Layout follows U1: toolbar across the top, thumbnail strip on the left, page view in the center, collapsible right panel with Fields, Snippets and Signatures tabs. At widths below 1024 px the thumbnail strip collapses into a toggle and the right panel overlays the page, which keeps P3's "must not throw" without designing for phones.

**Empty state** (U5): drop zone with an "Open PDF" button, the recent documents list (D6: name, page count, last modified, thumbnail; open and delete), and one paragraph in Tim's voice stating that nothing leaves the browser, linking to a Privacy page that explains the CSP and how to check it in the network tab.

**Pages**: one page at a time (V3), with Previous and Next buttons and `[`/`]`. Zoom presets: fit width, fit page, 50, 75, 100, 125, 150, 200, 250, 300%. Zoom and current page are part of the document record, so they persist per document (V3, D7).

**Gestures** (V4):
- The page scroll container has `touch-action: pan-x pan-y`, so the browser handles one-finger panning and leaves pinch to the app. The requirements' `pinch-zoom` value would let Safari zoom the whole page, which is the opposite of V4 (§16).
- Safari on iPad: `gesturestart`, `gesturechange` and `gestureend` are handled with `preventDefault()`, which is the only reliable way to stop iPadOS from zooming the page, since it ignores `user-scalable=no`. During the gesture the page is scaled with a CSS transform around the gesture center; on end, the zoom is committed (clamped to 50–300%) and the page re-renders.
- Other touch browsers: two active touch pointers are tracked and the distance ratio drives the same transform.
- Desktop: Ctrl+wheel (which is how trackpad pinch arrives in Chrome, Edge and Firefox) and Safari's gesture events on macOS trackpads zoom the page the same way.

**Keyboard** (U2): T, C, D, S, V, Esc, Cmd/Ctrl+S (export), Cmd/Ctrl+O (open), `[` and `]`, Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z, Delete/Backspace, arrows, and `?` for the help dialog. Single-letter shortcuts are ignored while focus is in a text control. Cmd/Ctrl+O is intercepted where the browser allows `preventDefault` (Chrome, Edge, Firefox); Safari keeps its own handling, and the toolbar button remains.

**Snippets into fields** (N2): the snippet panel shows a target line, "Fills: ‹field label›", whenever a text field was the last focused control and the user has not clicked elsewhere on the page since. Snippet buttons call `preventDefault` on `pointerdown` so a mouse or touch click does not steal focus, and a keyboard user who tabs to the panel still fills the field named on the target line. With no target field, the snippet becomes a text overlay at `lastPoint`.

**Errors** (U6): all failures are shown inline in plain language from a fixed message table keyed by problem code (`file.not-pdf`, `file.too-large`, `pdf.password-wrong`, `pdf.damaged`, `export.failed`, `export.verify-failed`, `storage.unavailable`, `storage.full`, and so on). Raw exception text goes only to the console.

### 10.5 Persistence (M1–M4, D5–D7)

IndexedDB database `bogey`, version 1:

| Store | Key | Value |
| --- | --- | --- |
| `documents` | `id` | `{ id, name, pageCount, formType, xfa, encrypted, thumbnail: ArrayBuffer, createdAt, updatedAt, lastPage, zoom, fieldValues, overlays, schemaVersion }` |
| `documentBytes` | `id` | `{ id, bytes: ArrayBuffer, size, sha256 }` |
| `signatures` | `id` | `{ id, name, kind, png: ArrayBuffer, width, height, createdAt }` |
| `snippets` | `id` | `{ id, label, value, order }` |
| `settings` | `key` | `{ key, value }`: `dateFormat`, `activeDocumentId`, `defaultFontSize`, `firstRunNoticeDismissed`, `persistRequested` |

Binary data (PDF bytes, thumbnails, signature PNGs) is stored as `ArrayBuffer`, not `Blob`. Sprint 0 found that WebKit intermittently aborts IndexedDB transactions that hold Blobs ("Error preparing Blob/File data to be stored in object store", the same failure Safari has long shown in private browsing), while ArrayBuffers stored reliably in all three engines. The app converts to `Blob` only for display and download.

The original bytes moved out of `documents` into `documentBytes` (§16): the bytes are written once on open and never again, while the document record is rewritten on every autosave, and a single record of up to 50 MB would make every autosave copy the file.

- **Writes** (M1): the document record is written 500 ms after the last edit, and at once on `visibilitychange` to hidden and on `pagehide`. iPadOS may suspend the page before a transaction started on `pagehide` commits, so the hidden-state flush is the one that matters there; the worst case is the last 500 ms of edits. All storage work runs through one ordered queue, so a record never references bytes that have not been written.
- **Recent list** (D6): when a 21st document is added, the least recently updated one other than the active document is deleted (record and bytes in one transaction). Documents not updated for 30 days are also deleted on load (`config.ts`), because signed forms containing personal details should not accumulate on a shared machine indefinitely (§16). Signatures and snippets are kept until the user deletes them or clears everything.
- **Restore** (D7): on load, `settings.activeDocumentId` is read; if its record and bytes exist, the document reopens at its saved page and zoom. An encrypted document asks for its password first, and Cancel shows the recent list. If the record or bytes are missing (Safari evicted them, or the user cleared site data), the app shows the empty state with a notice and does not fail.
- **Migrations**: records carry `schemaVersion`; a migration table upgrades older records, and a record that cannot be read is deleted with a notice, as in Mulligan.
- **Storage budget**: before storing bytes, `navigator.storage.estimate()` is checked; if the file would bring usage above 80% of quota, the document opens in memory only with a notice ("Opened, but not saved on this device"). `QuotaExceededError` on any write switches the app to in-memory mode (M3).
- **Persistence request** (M4): `navigator.storage.persist()` is called on the first successful document open, once, and the result is stored but only informs the Privacy page.
- **In-memory mode** (M3): if IndexedDB fails to open within 3 s or throws, everything works from memory and a persistent banner says so.
- **Clear everything** (S7): one confirmation, then the same fail-closed removal as Mulligan's clear: wait for pending writes, close the connection, `indexedDB.deleteDatabase('bogey')`, treat a deletion still blocked after 5 s as failed, and reload only after the browser confirms deletion. If deletion fails, nothing on screen is reset, saving stops, and the message tells the user to clear the site's data in browser settings. The app-shell cache is not touched, since it holds no user data.

### 10.6 Snippets (N1–N4, M2)

On first run the store is seeded with the six empty snippets from N1. "Today" (N4) is not stored; it is a fixed first button that inserts `formatDate(today, settings.dateFormat)`. Labels and values are edited inline (N3), reordered with dnd-kit (keyboard and pointer), and deleted with a button. Empty snippets render disabled with a hint to fill them in.

Export writes `bogey-snippets.json`:

```json
{ "bogeySnippets": 1, "exportedAt": "2026-11-06T14:30:00Z",
  "snippets": [ { "label": "Full name", "value": "…" } ] }
```

Import (M2) accepts that shape only, validated by zod: file at most 256 KB, at most 200 snippets, labels at most 60 characters, values at most 2,000. `planSnippetMerge` matches labels case-insensitively after trimming; the confirmation lists the labels that will be overwritten, and new labels are appended in file order. Lookups use `Map`, so keys such as `__proto__` are ordinary strings.

Date formats (O5): `MM/DD/YYYY` (default), `YYYY-MM-DD`, `DD MMM YYYY`, `Month D, YYYY`, with English month names. Settings also hold the default text size.

### 10.7 Browser support (P1–P4)

Targets: current stable Chrome, Edge, Firefox and Safari on macOS, Windows and Linux, and Safari on the current iPadOS major. Required features (all present in those targets): module workers, Pointer Events, `createImageBitmap` with resize options, IndexedDB with ArrayBuffer values, `Intl.DateTimeFormat`, Trusted Types where supported (Chromium and Safari; Firefox relies on the CSP alone). Feature checks at startup show a single message on an unsupported browser rather than partial behavior. Download always uses an anchor with `download` (P4); the File System Access API is not used.

---

## 11. Security, privacy and resource limits

Bogey is a public site with no access control and no server-side data. Its security, like Mulligan's, comes down to two things: only code we built and reviewed runs on the Bogey origin, and nothing other than the user's own gestures gets content into a session. Bogey handles more sensitive material than Mulligan (signatures, filled personal details, government forms), which raises the stakes on data left on the device and on hostile input files.

### 11.1 Threat model

| # | Threat | Example | Primary controls |
| --- | --- | --- | --- |
| T1 | Session injection by link | `bogey…/?open=https://evil/form.pdf` preloads a document the user then signs | No URL-driven state (§11.2) |
| T2 | Cross-window injection | An attacker page frames Bogey or uses `postMessage` to feed it a file or click through a signing | No `message` listeners on `window`; `frame-ancestors 'none'`; COOP `same-origin` |
| T3 | Hostile PDF | Exploit in a parser, font-compiler JavaScript (CVE-2024-4367), decompression bomb, PDF JavaScript, launch actions, hostile field names | Parsing in workers, no eval path in pdf.js 6, no scripting, no annotation layer, limits and timeouts, field names as text only, JavaScript stripped from output (§11.4) |
| T4 | Script injection (XSS) | A field name, file name or snippet label reaches an HTML sink | React text nodes only, lint bans on HTML sinks, Trusted Types, strict CSP |
| T5 | Tampered application code | Bucket or dependency compromise; with a service worker, a tampered build could also persist in visitors' caches | Same supply-chain and hosting controls as Mulligan; service worker update rules and a kill switch (§11.5, §11.6) |
| T6 | Lookalike site | A modified copy that does upload documents | Not preventable; canonical domain, HSTS, About page shows build identity |
| T7 | Data left on a shared machine | Saved signatures and filled forms on a borrowed computer | Clear everything, first-run notice, 30-day document expiry, dedicated origin (§11.7) |
| T8 | Cost abuse | Request floods | Shield Standard, WAF rate rule, budget alarm (as Mulligan) |
| T9 | Exfiltration to Bogey's own origin | Compromised code encodes data in a same-origin `GET` | CloudFront accepts `GET`/`HEAD` only, access logging off, S3 not writable by the distribution, lint bans on network APIs, E2E request allow-list (§11.3) |

As in Mulligan, CORS is not a control here, and no `Access-Control-Allow-Origin` header is set.

### 11.2 Input channels

Content enters only by file drop on the drop zone, the file picker, typing, the signature canvas, and the snippet import picker, all requiring a gesture on the Bogey page. Session restore from IndexedDB is the one internal channel. The rules from Mulligan carry over and are enforced the same way (ESLint `no-restricted-globals`, `no-restricted-properties` and `no-restricted-syntax`, plus review):

- No URL-driven state: no reading `location.search` or `location.hash`, no router. A link to Bogey opens either the empty state or the user's own saved session.
- No `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon` in application code. The exceptions are pdf.js's own asset loading (configured URLs under `/pdfjs/`) and `sw.ts`, which is excluded from that rule by path and has its own allow-list of URLs from the precache manifest.
- No `message` listeners on `window`, no `window.open`, no `opener`.
- `dragover` and `drop` are cancelled everywhere except the drop zone, which reads only `DataTransfer.files` and ignores `text/uri-list` and `text/html`.
- Links inside PDFs are never rendered as links (there is no annotation layer), so a document cannot navigate the tab.

### 11.3 Response headers

Defined once in `apps/web/security/headers.json`, served by `vite preview` (minus HSTS and `upgrade-insecure-requests`, for the localhost reasons recorded in Mulligan's spec), and generated into the CloudFront response headers policy; `tooling/test/infra.test.ts` holds the two equal.

```
Content-Security-Policy:
  default-src 'none';
  script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self';
  style-src 'self';
  img-src 'self' blob: data:;
  font-src 'self';
  connect-src 'self';
  manifest-src 'self';
  object-src 'none';
  base-uri 'none';
  form-action 'none';
  frame-src 'none';
  frame-ancestors 'none';
  require-trusted-types-for 'script';
  trusted-types default;
  upgrade-insecure-requests
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=(), clipboard-read=()
```

Differences from S2, all tightening it except one:

- `style-src 'self'` without `'unsafe-inline'`, as S2 prefers. Overlay positions are set through React `style` props, which use the CSSOM and are not governed by `style-src`.
- `worker-src 'self'` without `blob:`. Both workers and the service worker are same-origin files.
- `'wasm-unsafe-eval'` is added for pdf.js's WASM image decoders (JPEG 2000 and others in current versions). It permits compiling WebAssembly, not JavaScript `eval`. If the pinned pdf.js version decodes everything in JavaScript, this keyword is removed.
- Trusted Types: the `default` policy defines only `createScriptURL` and admits the pdf.js worker, the pdf worker and `/sw.js` (`navigator.serviceWorker.register` is a script-URL sink). Every HTML sink still throws.

On `connect-src 'self'`: it lets pdf.js fetch fonts, CMaps and WASM from `/pdfjs/`, and lets the service worker fetch the shell. The remaining risk is that compromised code could send a same-origin request carrying data. That request has no destination: the CloudFront distribution allows only `GET` and `HEAD`, standard and real-time access logging are off, the origin is a private bucket that the distribution can only read, and unknown paths return the app's 404. ESLint bans network APIs in application code, and an E2E test records every request during a full open–fill–sign–export session and fails on any request that is not a `GET` to a path in the build manifest or under `/pdfjs/` (S1).

Font loading by pdf.js uses the `FontFace` API with binary data, which `font-src` does not govern. Sprint 2 confirms that the pinned version raises no CSP or Trusted Types violations in all three engines, which the E2E fixture enforces from then on.

### 11.4 Hostile input files

- **Header check and size cap** before parsing (§6.1). Maximum 50 MB and 2,000 pages.
- **Parsing off the main thread.** pdf.js parses in its worker and pdf-lib in the pdf worker. Each call has a timeout (inspection 30 s, page render 20 s, export 60 s); on timeout the worker is terminated and replaced, and the user sees `pdf.damaged` or `export.failed`.
- **No code execution from the document.** pdf.js 6 has no eval path; no pdf.js scripting sandbox is loaded (`enableScripting` is never set); no XFA HTML rendering; no annotation layer; no link following; embedded files are never opened.
- **Field names and values are data.** They are rendered as React text, looked up with `Object.hasOwn`, and length-capped for display (names at 200 characters, values at 10,000).
- **Output hygiene.** Export removes document JavaScript and additional actions (§9.1 step 4). Embedded files and other content of the original are left as they were, since they are the sender's content and the recipient already has them.
- **Signature uploads** are decoded by the browser and re-encoded (§8.2), with size and dimension caps.
- **Snippet imports** are schema-validated JSON with size caps (§10.6).

### 11.5 Service worker

Mulligan ships no service worker; Bogey needs one for S8, so it is written to keep the attack surface small:

- `sw.ts` is built to `/sw.js` (unhashed, `Cache-Control: no-cache`) by a small Vite plugin that also injects the precache manifest: `index.html`, every hashed JS and CSS asset, both workers, the Liberation Sans fonts, `/pdfjs/standard_fonts/`, `/pdfjs/wasm/` and `/pdfjs/iccs/`, with the build id as the cache name.
- **Install** precaches the manifest. **Activate** deletes caches with other names. **Fetch** answers same-origin `GET`s from the cache first, falls back to the network, serves the cached `index.html` for navigations, and passes through everything else untouched. `/pdfjs/cmaps/` (about 1.5 MB, needed only for CJK documents) is cached at runtime on first use rather than precached, so a CJK document opened for the first time while offline will render with missing glyphs (§16).
- **Updates** (B7): registration uses `updateViaCache: 'none'`, so the browser always checks `sw.js` against the network on navigation. A new worker waits; the app shows "A new version is ready. Reload to update." and on click posts `skipWaiting` to the waiting worker and reloads on `controllerchange`. Edits in progress are already saved, so the reload is safe.
- **Kill switch**: `scripts/sw-kill.ts` produces a `sw.js` that unregisters itself and deletes its caches, for use if a bad or compromised build ever needs to be purged from visitors' browsers.
- The service worker does not touch IndexedDB, does not handle `message` events except the one `skipWaiting` command, and imports no scripts.

### 11.6 Integrity of the code we serve

As in Mulligan's §10.5: private versioned S3 bucket behind CloudFront with Origin Access Control, `pnpm install --frozen-lockfile`, install scripts blocked except for the `allowBuilds` list, `pnpm audit` in the gate with high severity failing it (S10), exact version pins for `pdfjs-dist` and `@cantoo/pdf-lib`, and a deploy that refuses uncommitted work. The controls Mulligan deferred (OIDC deploy role, CloudTrail write alerts, published hashes with a drift check, Subresource Integrity, CAA records) are deferred here too and listed in the backlog. pdf.js security releases are the dependency most worth watching, and the backlog includes a monthly check of its release notes.

### 11.7 Hosting and data on the device

- **Domain**: `bogey.beta-site.us`, a dedicated origin, because IndexedDB, CSP and Trusted Types are scoped by origin and sharing one with other apps would let their scripts read saved signatures.
- **Stack**: `infra/bogey.yaml`, adapted from Mulligan's: private versioned bucket, OAC, ACM certificate validated in the `beta-site.us` zone, A and AAAA aliases, the response headers policy, allowed methods `GET`/`HEAD`, logging disabled, WAF rate rule (500 requests per IP per five minutes), and a monthly $15 budget alarm on the `Project=bogey` tag. Hashed assets get `max-age=31536000, immutable`; `index.html`, `sw.js` and `/pdfjs/*` (unhashed paths) get `no-cache` (B6).
- **Deploy**: `pnpm infra:deploy` creates or updates the stack. `pnpm deploy:site` runs the gate, builds with the commit as build id, uploads with per-path cache headers, deletes stale files last, invalidates `/index.html` and `/sw.js`, and runs `check-live-headers.mjs`, which fails unless every header matches on the page, a script, both workers and `sw.js`, including their 304 revalidations.
- **On the device** (T7): the first time a document is saved, a dismissible notice explains that documents, signatures and snippets are kept in this browser until cleared, with the Clear everything button beside it. Clear everything is always in the settings menu and on the Privacy page. Documents expire after 30 days of no edits. Blob URLs for thumbnails, previews and downloads are revoked when no longer displayed. In private browsing, storage is ephemeral or unavailable and the app runs in memory-only mode.

### 11.8 Resource limits (`apps/web/src/config.ts`)

| Limit | Default |
| --- | --- |
| PDF file size | 50 MB (D2) |
| Pages per document | 2,000 |
| Recent documents | 20 (D6) |
| Document expiry | 30 days without edits |
| Storage use before falling back to memory-only | 80% of `storage.estimate().quota` |
| Canvas pixels per page | 16,777,216 |
| Fully rendered pages | current ± 1 (V6) |
| Thumbnail cache | 60 |
| Signature upload | 20 MB, decoded long edge ≤ 2,000 px |
| Undo steps | 100 (O8) |
| Worker timeouts | inspect 30 s, render 20 s, export 60 s |
| Snippet import | 256 KB, 200 snippets |
| Autosave debounce | 500 ms (M1) |

---

## 12. Error handling

Core returns typed problems for all input faults. Worker failures (timeouts, `error` and `messageerror` events, out-of-memory) are caught by the worker host, which terminates and replaces the worker, retries an inspection once, and otherwise reports a classified problem. pdf.js `PasswordException`, `InvalidPDFException` and `MissingPDFException` map to the password flow and to `pdf.damaged`. IndexedDB failures switch to in-memory mode with a banner and never block work. A React error boundary around the workspace offers "Reload (your work is saved)", or "Reload (unsaved work will be lost)" in memory-only mode. Messages come from the fixed table in §10.4, so no raw exception text reaches the user (U6).

---

## 13. Accessibility

WCAG 2.2 AA, as in Mulligan. Field controls are real form controls with accessible names (U4). Overlays are focusable buttons with labels ("Text overlay: John Smith, page 2") and can be moved with arrow keys. Tool selection, page changes and undo announce through a polite live region. The signature canvas has a text alternative explaining that drawing needs a pointer and that uploading an image is the keyboard path. Snippet reordering uses dnd-kit's keyboard sensor with announcements. Focus is trapped in dialogs and returns to the invoking control on close. Severity and state are never conveyed by color alone. Sprint 7 includes an axe pass in Playwright and a manual VoiceOver pass on macOS and iPadOS.

---

## 14. Testing

### 14.1 Layers

| Layer | Tooling | Runs in |
| --- | --- | --- |
| Core unit and fixture tests (geometry, inspection, edits, history, export, image ops, snippets) | Vitest | Node, plus Chromium, Firefox and WebKit in browser mode |
| Core property tests | `fast-check` | Node and Chromium |
| Rendering and placement tests (X5 pixel sampling, thumbnail, canvas cap) | Vitest browser mode with pdf.js | Chromium, WebKit |
| Web component tests | Vitest, RTL, jsdom | Node |
| End-to-end | Playwright against the production build with production headers | Chromium (all specs); Firefox and WebKit (smoke, security, signature, export); WebKit with the iPad Pro device descriptor and touch for gesture specs |
| Manual device checks | `docs/ipad-checklist.md` | A real iPad with Apple Pencil at each milestone from Sprint 5 |

Coverage is global and all four metrics must be at least 80%, with `main.tsx`, the worker entry files and `sw.ts` excluded, as in Mulligan. Every E2E test fails on any CSP or Trusted Types violation or page error, using Mulligan's fixture from `e2e/helpers.ts`.

### 14.2 Fixtures

As specified in the requirements' Appendix A, with `fixtures/manifest.json` as the single input. `tooling/test/fixtures.test.ts` asserts that every row of the A.5 coverage matrix has at least one manifest entry, and in CI (after `fetch-fixtures.sh`) that every listed file is present and matches its hash. Locally, tests skip absent fetched files with a visible count of skips. `make-fixtures.ts` is deterministic: it sets fixed creation dates and document ids so regenerated files are byte-identical and the hashes in the manifest stay stable.

### 14.3 Properties

- Geometry round trip: for random view boxes (including non-zero and negative origins), every rotation, `userUnit` in {1, 2} and zoom in [0.5, 3], `screenToPdf(pdfToScreen(p)) ≈ p` within 1e-9 pt.
- Agreement with pdf.js: `pdfToScreen` equals `PageViewport.convertToViewportPoint` for the same inputs within 1e-6 CSS px.
- Upright frame: for every rotation, a text overlay's exported first glyph origin, read back with pdf.js `getTextContent`, matches the stored anchor within 0.01 pt and its text direction matches the page rotation.
- History: `undo(historyApply(h, e))` restores `h.present`; `redo(undo(h))` restores `h`; history length never exceeds the limit; coalesced edits produce one step.
- Edit validation: random edit sequences never produce a state that fails schema validation, and invalid edits leave state unchanged.
- Snippet merge: importing a file twice produces the same result as importing it once.
- `removeNearWhite`: alpha is monotonically non-increasing in luminance, and pixels below `threshold − 16` are untouched.
- `outputFileName`: the result always ends in `-signed.pdf` and never contains a path separator or a Windows-forbidden character.

### 14.4 Export verification

For each fixture class: export with a known set of field values and overlays, then load the output with pdf-lib (no fields, no encryption, page count unchanged, `Producer` is `Bogey`, title and author preserved, no `/JavaScript` name tree, no `/OpenAction` JavaScript) and with pdf.js (`getTextContent` contains every overlay string and every filled text value at its expected position within 1 pt). The X5 visual check renders exported registration-mark fixtures with pdf.js at 4× and samples the pixels where an overlay placed on screen at the registration mark should appear.

### 14.5 End-to-end scenarios (B3)

- Open a flat PDF, add text, check, date and signature overlays, move and resize them, undo and redo, export, verify.
- Open the every-field-type AcroForm fixture, fill each type, tab through in order, use the Fields panel, export, verify flattened values.
- Open the encrypted fixture (wrong password, then `bogey`), fill, export, verify the output is unencrypted and the dialog warned.
- Open the XFA fixtures: notice shown, overlays work, export succeeds; the hybrid fixture fills its AcroForm fields.
- Draw a signature with synthetic `pointerType: 'pen'` events with varying pressure (dispatched in page), save, place, export. Upload a JPEG signature on white, adjust the threshold, save, verify transparency in the export.
- Snippets: fill from a snippet into a focused field and as an overlay; export and re-import the JSON.
- Reload mid-edit: document, page, zoom, values and overlays restored. Close and reopen the context: same.
- Recent list: 21 documents evicts the oldest; delete works.
- Clear everything: database gone, app empty after reload.
- Text placement: the rendered on-screen baseline of a 10 pt and a 36 pt text overlay matches the exported position within 1 pt (acceptance 2).
- iPad descriptor (WebKit, touch): pinch changes the app zoom and not the page zoom; a pan does not place an overlay; handles are at least 44 px.
- Performance: the 20-page 10 MB fixture exports within the CI budget (§9.3).

Security scenarios, against the production headers: zero CSP and Trusted Types violations across all specs; the request log of a full session contains only `GET`s to build-manifest paths and `/pdfjs/`; `?open=…`, `#…` and arbitrary paths load an empty or restored session and nothing else; a framing page cannot display the app; a `postMessage` from another window is ignored; a `text/uri-list` drag is ignored; a PDF with an `/OpenAction` JavaScript, a `/Launch` action and a link annotation runs nothing and navigates nowhere, and its export has no JavaScript; a non-PDF renamed `.pdf` is refused; a field named `__proto__` behaves as an ordinary field; offline after first load (Playwright `setOffline(true)`), the app opens, fills and exports a fixture (S8, acceptance 4).

---

## 15. Build, release and milestones

### 15.1 Workflow and CI

Same rules as Mulligan's `CLAUDE.md`: work on `sprint/NN-…`, `fix/…` or `feature/…` branches; `pnpm gate` (lint, typecheck, dependency-cruiser, `pnpm audit`, coverage tests, browser tests, build, E2E) must pass on the branch; merge to `master` with `--no-ff` and the coverage figures in the merge message; tag sprints `sprint-NN`. The repository has no remote yet, so the gate runs locally; `.github/workflows/ci.yml` (gate after `fetch-fixtures.sh`, with a cache keyed on the hash list) is written in Sprint 0 and runs once a remote is added. It does not deploy. Every sprint close deploys `master` to `bogey.beta-site.us` for review.

### 15.2 Milestones

The sprint breakdown, waves and exit gates are in `docs/Bogey Implementation Plan.md`, which supersedes the outline below. The outline is kept for its mapping to the requirements' build order (§14 there).

| Sprint | Scope | Exit criteria |
| --- | --- | --- |
| 0 | Scaffold, tooling, boundaries, CI, fixtures scripts and manifest; geometry module; infra stack; empty shell deployed; decryption spike (§9.6); pdf.js under the production CSP and Trusted Types in three engines | Geometry properties pass; live headers check passes on `bogey.beta-site.us`; spike results recorded in this document |
| 1 | Open and view: drop zone, header check, password dialog, pdf.js rendering, thumbnails, zoom, form-type detection, document records and restore, recent list | Open every fixture class; reload restores page and zoom; zero CSP violations |
| 2 | Flat overlays and export: text, check, date, select, drag, resize, nudge, delete, undo; export without fields; preflight; download | Flat E2E scenario and X5 sampling pass |
| 3 | AcroForm fields: enumeration, controls, tab order, Fields panel, appearance check, flattening, hybrid XFA | AcroForm and IRS fixtures export with correct flattened values |
| 4 | Signatures: library, draw dialog with pen pressure, upload with background removal, placement | Signature E2E passes; first iPad checklist run |
| 5 | Snippets and settings: panel, Today, field targeting, JSON import and export, date format | Snippet E2E passes |
| 6 | Hardening: memory bounds, storage fallbacks and expiry, service worker and update toast, kill switch, error table, accessibility pass | Offline E2E passes; full iPad checklist passes; axe clean |
| 7 | Acceptance: the five tests in the requirements' §15 on a Mac and an iPad; README (B8) and Help, About and Privacy pages in Tim's voice | v1 release tag |

### 15.3 Backlog at v1

Phase 2 items from the vision (page operations, typed signatures, sync, unflattened output, certified signatures, phone layout), plus the deferred hosting controls listed in §11.6 and a GitHub Actions OIDC deploy (B6).

---

## 16. Departures from the requirements and open items

### 16.1 Departures

| Requirement | Change | Reason |
| --- | --- | --- |
| Vision stack, B2 | `@cantoo/pdf-lib` instead of `pdf-lib` | Upstream cannot decrypt and is unmaintained; same API (§1, §9.6) |
| X1 | Geometry in `packages/core/src/geometry/`, not `src/geometry/` | Monorepo with a pure core (§2) |
| B2 | Adds `zustand`, `comlink`, `zod`, `@dnd-kit` | All reviewed and in use in Mulligan (§10.1) |
| B5 | CloudFormation | B5 defers to what Mulligan used, which is CloudFormation |
| B6 | Local deploy; CI runs the gate only | Matches Mulligan's current practice; OIDC deploy is backlog |
| S2 | No `'unsafe-inline'` styles, no `blob:` workers, adds `'wasm-unsafe-eval'`, Trusted Types, `object-src`, `frame-src`; HSTS without `preload` as specified | Tightening, plus WASM for pdf.js decoders (§11.3) |
| §9 data model | Original bytes in their own `documentBytes` store; records gain `xfa`, `encrypted`, `schemaVersion` | Autosave would otherwise rewrite the full file every 500 ms (§10.5) |
| D4 | Hybrid XFA forms are filled through their AcroForm fields, with XFA removed on export | Gives a filled form instead of typed-over text (§6.2) |
| E2 | Only user-changed fields are set; an appearance check precedes flattening | Preserves the original look of untouched fields, and prevents `flatten()` from dropping fields without appearances (§9.1) |
| V4 | `touch-action: pan-x pan-y` without `pinch-zoom`, and Safari gesture events cancelled | `pinch-zoom` would hand pinch to the browser, which is what V4 is trying to prevent (§10.4) |
| §9 data model | Binary values stored as `ArrayBuffer`, not `Blob` | WebKit aborts IndexedDB transactions holding Blobs intermittently (found in Sprint 0, §10.5) |
| G4 | 16-level alpha ramp below the threshold | Removes jagged fringes around anti-aliased ink (§8.2) |

### 16.2 Additions not in the requirements

All six were confirmed by the maintainer on 2026-11-06.

1. **Export strips document JavaScript and additional actions** (§9.1). Reverse this if any recipient workflow depends on scripts surviving in a flattened form, which seems unlikely.
2. **Documents expire after 30 days without edits**; signatures and snippets do not (§10.5). The period is one line in `config.ts`.
3. **Undo history is per session** and starts fresh after a reload (§7.4). Persisting it is possible but adds write volume for little benefit.
4. **Encrypted documents ask for their password again after a reload**, because the password and any decrypted copy are never stored (§10.5).
5. **CJK CMaps are cached on first use** rather than precached, so a first-time CJK document while offline may render with missing glyphs (§11.5).
6. **Encrypted documents that the pdf-lib fork cannot decrypt** export as page images after a confirmation (§9.5).

### 16.3 Settled in Sprints 0–3

1. Decryption: the fork handles the whole qpdf matrix, AES-256 owner-only included; mixed crypt filters fall back to page images (§9.6).
2. Pinned versions: `pdfjs-dist` 6.5.438 and `@cantoo/pdf-lib` 2.11.1. pdf.js uses WASM decoders, so `'wasm-unsafe-eval'` stays (§10.3).
3. `ENABLE_FORMS` behavior, with the canvas-map requirement and push-button redraw (§10.3).
4. pdf.js raises no CSP or Trusted Types violations in any engine. WebKit itself raises a `style-src-attr` violation whenever a native `<select>` is created; how Sprint 5 handles this is an open decision (§16.4).
5. CloudFront's 304 responses carry the policy headers; `check-live-headers.mjs` verifies it on every deploy.
6. Hybrid XFA: inspection treats placed widgets without appearance streams as usable (the two pdfium static-XFA fixtures), and export generates the missing appearances. The fixture manifest labels hybrid files `formType: 'xfa'` with `xfa: 'hybrid'`; `inspectPdf` returns `acroform` for them as §6.2 says.
7. pdf-lib logs "Failed to extract appearance ref" while flattening unchecked checkboxes that have only an on-state appearance (the IRS forms). Nothing is lost, since the page draws the empty box; checked boxes flatten correctly (verified on the W-9's "Other" and 3b boxes).

### 16.4 Decisions after wave 1

1. **Native `<select>` stays** (decided 2026-11-06). WebKit reports a `style-src-attr` violation from its own shadow tree whenever a `<select>` is created. It is a false positive for Bogey, and native controls give the iPad its system picker and built-in accessibility, so the E2E violation fixture ignores exactly that report: WebKit only, `style-src-attr`, blocked URI `inline`, event target `SELECT`. A self-test proves an inline style the page sets on any other element still fails in every engine. The real security policy is unchanged. Dropdown and list fields use `<select>` as §7.1 says.

### 16.5 Assumptions

Confirmed 2026-11-06: domain `bogey.beta-site.us` and license GPL-3.0-or-later. Still open:

1. The 2,000-page and 20 MB signature-upload limits in §11.8.
2. English-only UI and month names.

---

## Appendix A. Requirement traceability

| Requirements | Section |
| --- | --- |
| P1–P4 | §10.7, §10.4 (narrow widths), §9.1 (anchor download) |
| S1, S2, S3, S4, S5 | §11.3, §10.3 |
| S6 | §10.5, §11.2 |
| S7 | §10.5 |
| S8 | §11.5, §14.5 |
| S9 | §8.2 |
| S10 | §11.6, §15.1 |
| D1, D2 | §6.1 |
| D3 | §6.1, §10.5 |
| D4 | §6.2 |
| D5, D6, D7 | §6.1, §10.5, §10.4 |
| D8 | §9.1, §9.4 |
| V1, V2, V5, V6 | §10.3, §5.2 |
| V3, V4 | §10.4 |
| F1 | §6.3, §7.1 |
| F2–F8 | §7.1, §6.3 |
| O1, O9 | §4.1, §5.3, §5.5 |
| O2–O7 | §7.2 |
| O8 | §7.4 |
| G1, G5 | §8.3 |
| G2, G3 | §8.1 |
| G4 | §8.2 |
| G6, E5 | §9.1 |
| E1–E3, E6, E8, E9 | §9.1 |
| E4 | §9.2 |
| E7 | §9.3 |
| M1, M3, M4 | §10.5 |
| M2, N1–N4 | §10.6 |
| X1–X4 | §5 |
| X5 | §14.3, §14.4 |
| U1–U3, U5, U6 | §10.4, §10.1 |
| U4 | §7.1, §13 |
| B1, B2 | §1, §10.1 |
| B3 | §14 |
| B4 | §14.2 |
| B5, B6 | §11.7, §15 |
| B7 | §11.5 |
| B8 | §15.2 (Sprint 7) |
| Acceptance 1–5 | §14.5, §15.2 (Sprint 7) |
