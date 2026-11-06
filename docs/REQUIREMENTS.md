# Bogey — Requirements

Companion to VISION.md. This document is written for handoff to Claude Code: it specifies what v1 must do, the data it works with, the module boundaries, the build order, and how each requirement is verified. Requirements are numbered so they can be referenced from commits, issues, and tests.

## 1. Scope

**In scope (v1)**
- Open a PDF (including password-protected) entirely in the browser.
- Fill AcroForm fields natively; add free overlays (text, checkmark, date, signature) on any page.
- Capture and persist signatures (drawn with mouse, finger, or Apple Pencil; or uploaded as an image).
- Maintain a local profile of reusable text snippets.
- Export a flattened PDF.
- Persist working state in IndexedDB so a reload or accidental tab close loses nothing.
- Static hosting on S3 + CloudFront with a strict CSP and an offline-capable app shell.

**Out of scope (v1)** — see VISION.md "Explicitly deferred to phase 2"
- Merge, rotate, reorder, delete pages.
- Typed signatures, cryptographic signatures, audit trails.
- Any sync between devices.
- Unflattened output.
- XFA forms (detected and handled as flat pages).
- Phone layout.

## 2. Platforms and browsers

| ID | Requirement |
|---|---|
| P1 | Must work in the current stable release of Chrome, Edge, Firefox, and Safari on macOS, Windows, and Linux. |
| P2 | Must work in Safari on iPadOS (current major version), including touch and Apple Pencil input. |
| P3 | Layout must be usable from 1024 px wide upward. Narrower viewports may degrade but must not throw. |
| P4 | No feature may depend on an API unavailable in any of the above; where support differs (e.g. File System Access API), use the lowest common path (anchor download). |

## 3. Privacy and security

| ID | Requirement |
|---|---|
| S1 | The application makes no network requests after the app shell has loaded, other than fetching its own static assets from the same origin. This is enforced by CSP, not just by convention. |
| S2 | CSP header (set at CloudFront): `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. `connect-src 'self'` is required only for the service worker; if the service worker is omitted it becomes `'none'`. `style-src 'unsafe-inline'` may be removed if the UI library permits; prefer removing it. |
| S3 | Additional headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`. |
| S4 | No third-party scripts, fonts, analytics, or CDN-hosted dependencies. Every byte served comes from the build output. |
| S5 | pdf.js's worker is bundled and loaded from the same origin, never from a CDN URL. |
| S6 | Document bytes are held in memory and in IndexedDB only. They are never written to `localStorage`, never placed in a URL, never posted anywhere. |
| S7 | A "Clear everything" action deletes the IndexedDB database in full and reloads. It requires one confirmation. |
| S8 | The site functions with the network disconnected after a first load (service worker caches the app shell). This is a verification aid for S1 as much as a feature. |
| S9 | Uploaded signature images are decoded via `createImageBitmap`/canvas and re-encoded to PNG by the app; the original uploaded bytes are discarded. (Strips metadata; also normalizes format.) |
| S10 | Dependencies are pinned, and `npm audit` runs in CI. The dependency list is kept short on purpose. |

## 4. Document lifecycle

| ID | Requirement |
|---|---|
| D1 | Open via drag-and-drop onto the page or a file picker. Accept `application/pdf` and `.pdf`; reject others with a message. |
| D2 | Maximum file size 50 MB. Larger files are refused with a message rather than attempted. |
| D3 | If the PDF is encrypted, prompt for a password. Retry on failure; cancel returns to the open state. The password is held in memory for the session only and is never persisted. |
| D4 | On open, detect the form type: `acroform` (has AcroForm fields), `xfa` (has XFA stream), or `flat`. XFA documents show a non-blocking notice ("This is an XFA form; fields can't be filled directly. You can still type over the page.") and are treated as `flat`. |
| D5 | Each opened document gets a document record (see §9) persisted to IndexedDB immediately, before any editing. |
| D6 | Only one document is "active" at a time. The app shows a list of recently opened documents (name, page count, last modified, thumbnail of page 1) with open and delete actions. Cap the list at 20; oldest is evicted when a 21st is added. |
| D7 | Reloading the app restores the most recently active document at the page and zoom the user was on. |
| D8 | On export, produce a flattened PDF as described in §8 and trigger a download named `<original-stem>-signed.pdf`. The original bytes and overlay state remain so the user can export again. |

## 5. Viewing

| ID | Requirement |
|---|---|
| V1 | Render pages with pdf.js to canvases at the device pixel ratio so text is crisp on Retina/iPad displays. |
| V2 | A thumbnail strip (left or top) lists all pages; clicking jumps to that page. Thumbnails render lazily. |
| V3 | Main view shows one page at a time with zoom levels: fit-width, fit-page, and 50–300 % in steps. Zoom persists per document. |
| V4 | On iPad, pinch-zoom on the page canvas adjusts the app's zoom level rather than the browser's page zoom (`touch-action: pan-x pan-y pinch-zoom` on the scroll container and handling of `gesturechange`/pointer events as needed). |
| V5 | Page rotation metadata in the PDF (`/Rotate`) is honored in display and in coordinate mapping. |
| V6 | Render only the active page and its neighbors at full resolution; release canvases for pages far from the current one to bound memory on iPad. |

## 6. Filling

### 6.1 AcroForm fields

| ID | Requirement |
|---|---|
| F1 | On open of an `acroform` document, enumerate all fields with pdf-lib. Supported types: text (single and multiline), checkbox, radio group, dropdown (combo), option list. Unsupported types (button, signature field) are shown as read-only outlines. |
| F2 | For each supported field widget, position an HTML input over the rendered page at the widget's rectangle, mapped via the geometry module (§10). Inputs scale with zoom. |
| F3 | Editing an input updates the field value in app state immediately; state is persisted to IndexedDB (debounced ≤ 500 ms). |
| F4 | Text field inputs respect the field's max length, multiline flag, and comb flag where present. |
| F5 | Checkbox and radio inputs reflect the field's on-state names; setting them writes the correct appearance state. |
| F6 | Fields in the overlay layer can be tabbed through in document order. |
| F7 | A "Fields" side panel lists all fields by name with their current values, allowing the user to find and fill a field without hunting for it on the page. Clicking a row scrolls to and focuses the widget. |
| F8 | Read-only fields are displayed but not editable. |

### 6.2 Free overlays

| ID | Requirement |
|---|---|
| O1 | Overlay types: `text`, `check`, `date`, `signature`. Every overlay has a page index, an anchor position in PDF points (bottom-left origin), and a size. |
| O2 | A toolbar selects the active tool; clicking or tapping on the page in a tool places a new overlay at that point. The default tool after placement reverts to "select". |
| O3 | Text overlay: Helvetica, default 10 pt, size adjustable 6–36 pt, bold toggle, black. Single-line by default; Shift+Enter inserts a line break. Width is auto; height follows line count. |
| O4 | Check overlay: draws a ✓ (ZapfDingbats a20) or an X, user's choice, sized 8–24 pt. |
| O5 | Date overlay: a text overlay pre-filled with today's date in the format chosen in Settings (default `MM/DD/YYYY`; options `YYYY-MM-DD`, `DD MMM YYYY`, `Month D, YYYY`). Editable after placement. |
| O6 | Signature overlay: places a saved signature image (§7). Resizable with aspect ratio locked; default width 150 pt. |
| O7 | Any overlay can be selected, dragged, nudged with arrow keys (1 pt; 10 pt with Shift), resized where applicable, and deleted (Delete/Backspace key or a button). On iPad, drag handles must be at least 44 × 44 CSS px. |
| O8 | Undo/redo for overlay create, move, resize, edit, and delete, and for field value changes. Minimum 50 steps. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z. |
| O9 | Overlays snap to a 1 pt grid; no other snapping in v1. |

## 7. Signatures

| ID | Requirement |
|---|---|
| G1 | A signature library stores an unlimited number of items, each with a name, a kind (`signature` or `initials`), a transparent PNG, and its natural size in pixels. Persisted in IndexedDB. |
| G2 | **Draw.** A modal canvas of at least 600 × 200 CSS px, rendered at device pixel ratio. Uses Pointer Events exclusively (no `touchstart`/`mousedown` handlers). The canvas has `touch-action: none`. Strokes from `pointerType === 'pen'` use `pressure` to vary width between 1.5 and 4 px; mouse and touch use a constant 2.5 px. Strokes are smoothed (quadratic Bézier between midpoints). Buttons: Clear, Cancel, Save. |
| G3 | On Save of a drawn signature, trim the canvas to the bounding box of non-transparent pixels with 8 px padding and store the result. |
| G4 | **Upload.** Accept PNG, JPG, WEBP, HEIC where the browser decodes it. Convert to a canvas; pixels with luminance ≥ 235 become transparent (threshold adjustable with a slider in the dialog, default 235); trim to bounding box; store as PNG. Show a preview on a checkerboard before saving. |
| G5 | The signature picker shows thumbnails; clicking one enters "place signature" mode. Items can be renamed and deleted. |
| G6 | Signatures are exported as part of the embedded images at export time (§8); a signature used on several pages is embedded once. |

## 8. Export

| ID | Requirement |
|---|---|
| E1 | Export operates on the original document bytes loaded fresh into pdf-lib (never on a previously exported result). |
| E2 | For `acroform` documents: set each field's value from app state, call `form.updateFieldAppearances()` with Helvetica, then `form.flatten()`. |
| E3 | For all documents: draw each overlay onto its page with `page.drawText` / `page.drawImage` using the geometry module's conversion, after flattening, so overlays sit above field content. |
| E4 | Text overlays use the standard Helvetica (or Helvetica-Bold) font. Characters outside WinAnsi are replaced with `?` and the user is warned before download listing the affected overlays. |
| E5 | Signature images are embedded as PNG with `embedPng`. |
| E6 | Output is produced with `pdfDoc.save({ useObjectStreams: true })`, wrapped in a `Blob` of type `application/pdf`, and downloaded via an anchor with `download` attribute. On iPadOS the same path opens the share sheet / Files save, which is acceptable. |
| E7 | Export must complete in under 5 seconds for a 20-page, 10 MB document on a 2020-era laptop; show a progress indicator if it exceeds 500 ms. |
| E8 | The export preserves document metadata (title, author) from the original and sets `Producer` to `Bogey`. |
| E9 | If the original is encrypted, the output is not encrypted. The user is told this in the export dialog. |

## 9. Persistence and data model

IndexedDB database `bogey`, version 1, via the `idb` wrapper. Object stores:

```
documents   keyPath: id
  id            string (uuid)
  name          string (original filename)
  bytes         ArrayBuffer (original PDF)
  pageCount     number
  formType      'acroform' | 'xfa' | 'flat'
  thumbnail     Blob (PNG of page 1, ~200 px wide)
  createdAt     number (epoch ms)
  updatedAt     number
  lastPage      number
  zoom          number | 'fit-width' | 'fit-page'
  fieldValues   Record<fieldName, string | boolean | string[]>
  overlays      Overlay[]

signatures  keyPath: id
  id            string
  name          string
  kind          'signature' | 'initials'
  png           Blob
  width         number (px)
  height        number (px)
  createdAt     number

snippets    keyPath: id
  id            string
  label         string
  value         string
  order         number

settings    keyPath: key
  key           string   e.g. 'dateFormat', 'activeDocumentId', 'defaultFontSize'
  value         any
```

```ts
type Overlay =
  | { id: string; type: 'text';      page: number; x: number; y: number; text: string; size: number; bold: boolean }
  | { id: string; type: 'check';     page: number; x: number; y: number; glyph: 'check' | 'x'; size: number }
  | { id: string; type: 'date';      page: number; x: number; y: number; text: string; size: number; bold: boolean }
  | { id: string; type: 'signature'; page: number; x: number; y: number; width: number; height: number; signatureId: string };
```

`x`, `y` are in PDF points with bottom-left origin on the unrotated page (the geometry module handles rotation). For text, `(x, y)` is the baseline-left of the first line. For images and checks, `(x, y)` is the bottom-left corner of the box.

| ID | Requirement |
|---|---|
| M1 | Every mutation to a document record is written to IndexedDB, debounced to at most one write per 500 ms per document, and flushed on `visibilitychange` → hidden and `pagehide`. |
| M2 | Snippet profile supports export to and import from a JSON file (`bogey-snippets.json`). Import merges by label; existing labels are overwritten after confirmation. |
| M3 | If IndexedDB is unavailable or throws (private browsing on some browsers, quota exceeded, eviction), the app continues in memory-only mode with a persistent banner saying so. |
| M4 | Call `navigator.storage.persist()` on first use to reduce the chance of eviction on Safari; the result is informational only. |

## 10. Geometry module

This module is written and tested first.

| ID | Requirement |
|---|---|
| X1 | Pure functions, no DOM, fully unit-tested, in `src/geometry/`. |
| X2 | `pdfToScreen(page: PageGeometry, pt: {x, y}, zoom: number): {x, y}` and `screenToPdf(...)` are exact inverses. `PageGeometry` carries the page's media box, crop box, and `/Rotate` value. |
| X3 | Handles rotations of 0, 90, 180, 270 and crop boxes whose origin is not (0, 0). |
| X4 | Converts an AcroForm widget rectangle (`/Rect` in PDF space, possibly with a `/MK /R` rotation) to a screen rectangle. |
| X5 | Tests include at least one real-world PDF for each rotation and one with a non-zero crop box origin, asserting that a point placed on screen round-trips to within 0.01 pt and lands visually where expected in the exported file (checked by rendering the export with pdf.js and sampling pixels). |

## 11. Snippets

| ID | Requirement |
|---|---|
| N1 | A side panel lists snippets as buttons with their label. Default seed on first run: Full name, Address line 1, Address line 2, City/State/ZIP, Phone, Email — all empty until the user edits them. |
| N2 | Clicking a snippet while an AcroForm text input is focused sets that field's value. Otherwise it creates a text overlay at the last clicked page position, or at the page's top-left margin if nothing has been clicked. |
| N3 | Snippets are editable inline (label and value), reorderable by drag, and deletable. |
| N4 | A "Today" snippet is always present and inserts the date in the configured format. |

## 12. User interface

| ID | Requirement |
|---|---|
| U1 | Layout: top toolbar (open, tools, undo/redo, zoom, export, settings), left thumbnail strip, center page view, right panel with tabs for Fields, Snippets, Signatures. The right panel collapses. |
| U2 | Keyboard shortcuts: T text, C check, D date, S signature, V select, Esc cancel tool, Cmd/Ctrl+S export, Cmd/Ctrl+O open, [ ] previous/next page. Shown in a help dialog (`?`). |
| U3 | Visual style is restrained and consistent with Mulligan; no decorative chrome. Light and dark modes follow the OS preference. |
| U4 | All interactive elements have accessible names; the field overlay inputs are real inputs so screen readers and the browser's own form behavior work. |
| U5 | Empty state (no document open) shows the drop zone, the recent documents list, and one paragraph explaining that nothing leaves the browser, with a link to the CSP headers as evidence. |
| U6 | Errors (bad file, wrong password, export failure, storage failure) are shown inline with a plain explanation; never a raw exception. |

## 13. Build, hosting, and deployment

| ID | Requirement |
|---|---|
| B1 | Vite + React + TypeScript (strict). ESLint and Prettier configured. Node LTS. |
| B2 | Dependencies: `pdfjs-dist`, `pdf-lib`, `idb`, React, and a small set of UI primitives. Each addition beyond these is justified in the PR. |
| B3 | Unit tests with Vitest for geometry, overlay reducers, export assembly, and image processing. Browser tests with Playwright covering: open a flat PDF and add overlays; open an AcroForm PDF and fill fields; draw and place a signature; export and verify the output with pdf-lib (field values flattened, overlay text present via pdf.js text extraction); reload restores state. |
| B4 | A `fixtures/` directory holds test PDFs: flat single page, flat multi-page with rotation, AcroForm with each field type, password-protected, XFA, and a 10 MB / 20-page sample. Sources and layout are specified in Appendix A. |
| B5 | Infrastructure as code (CDK or Terraform, whichever Mulligan used) for: private S3 bucket, CloudFront distribution with Origin Access Control, response headers policy carrying §3 headers, ACM certificate, Route 53 record. |
| B6 | GitHub Actions: on push to `main`, run lint, unit tests, Playwright tests, build, then sync to S3 and invalidate `/index.html` and `/sw.js` using an OIDC-assumed role. Hashed assets get `Cache-Control: public, max-age=31536000, immutable`; `index.html` and `sw.js` get `no-cache`. |
| B7 | Service worker precaches the app shell (`index.html`, JS, CSS, pdf.js worker, fonts) and serves it cache-first; updates on next load with a "reload to update" toast. |
| B8 | README covers local dev, running tests, deploying, and the privacy posture in one page. |

## 14. Build order

Each step ends in a working, deployable state.

1. **Scaffold and geometry.** Vite project, CI, fixtures, geometry module with tests (§10). Deploy an empty shell to confirm the hosting and headers (§3, §13).
2. **Open and view.** Drop zone, password prompt, pdf.js rendering, thumbnails, zoom, form-type detection, document record persisted and restored (§4, §5, M1).
3. **Flat overlays and export.** Text, check, date overlays with select/drag/delete and undo; export of overlays only (§6.2, §8 minus E2).
4. **AcroForm fields.** Field enumeration, overlay inputs, Fields panel, flattening on export (§6.1, E2).
5. **Signatures.** Library, draw dialog with Pencil support, upload with background removal, placement (§7).
6. **Snippets and settings.** Panel, JSON import/export, date format (§11).
7. **Hardening.** Memory bounds on iPad (V6), storage fallbacks (M3, M4), service worker (B7), Playwright coverage (B3), accessibility pass (U4).

## 15. Acceptance

v1 is complete when, on a Mac browser and on an iPad:

1. A password-protected AcroForm PDF from the fixtures can be opened, every field type filled, a Pencil-drawn signature placed, and the export opened in Preview and Acrobat Reader showing the values and signature with no editable fields.
2. A flat scanned PDF can be filled with text, checks, a date, and a saved signature, and the export matches the on-screen placement to within 1 pt.
3. Closing the tab mid-edit and reopening the site restores the document, values, and overlays.
4. The browser's network tab shows no requests after the app shell load, and the site works in airplane mode.
5. The whole second-form workflow — open, fill from snippets, sign from the library, export — takes under one minute.

## Appendix A — Test fixtures and sources

Local forms are not a sufficient test base on their own. The fixtures directory combines vendored files from permissively licensed test suites with real-world forms fetched at build time and never committed.

### A.1 Layout

```
fixtures/
  vendored/          # committed; every file's origin and license recorded in LICENSES.md
    pdfium/          # hand-authored XFA and AcroForm minimal cases
    pypdf/           # py-pdf/sample-files selections (CC-BY-SA-4.0)
    pdf-lib/         # pdf-lib's own assets/pdfs selections (MIT)
    generated/       # files produced by scripts/make-fixtures.ts (see A.4)
  fetched/           # gitignored; populated by scripts/fetch-fixtures.sh
    pdfjs/           # sparse checkout of mozilla/pdf.js test/pdfs
    ircc/            # Canadian IRCC XFA forms
    irs/             # IRS fillable AcroForm forms
    qpdf/            # qpdf qtest suite, encryption cases only
  local/             # gitignored; the developer's own redacted forms
  LICENSES.md
  manifest.json      # every fixture with: path, source, license, formType, encrypted, rotation, pageCount, purpose
```

`manifest.json` is the single input to the test suite; tests iterate it and skip entries whose file is absent (so unit tests pass on a fresh clone without running the fetch script, and the Playwright suite in CI runs the fetch script first).

### A.2 Vendored suites

| Source | License | What it provides | Use |
|---|---|---|---|
| **pdfium** `testing/resources/` (pdfium.googlesource.com, mirrored in AOSP `external/pdfium`) | BSD-3 | Minimal hand-authored PDFs built from `.in` templates: `simple_xfa.pdf`, the `xfa/` directory (dynamic list boxes, password fields with rotation, barcode fields, captions), and many small AcroForm and annotation cases. | Primary XFA detection fixtures (D4). Small enough to debug by reading the file. |
| **pdf-lib** `assets/pdfs/` | MIT | The library's own fixtures: forms with every field type, a cropbox case, XFA-flagged forms, and the samples its documentation uses. Confirm exact filenames at clone time. | Fields enumeration and flattening (F1, E2) — anything pdf-lib itself tests against is the first thing Bogey should handle. |
| **py-pdf/sample-files** | CC-BY-SA-4.0 | A curated set of reader test files with `files.json` metadata. | General rendering coverage; the cleanest license for direct vendoring. |

### A.3 Fetched sources

| Source | License | What it provides | Use |
|---|---|---|---|
| **mozilla/pdf.js** `test/pdfs/` | Apache-2.0 for the repo; many entries are `.link` files pointing at external URLs because the PDFs themselves cannot be redistributed | The largest real-world corpus: rotation, non-zero crop box origins, encryption variants, AcroForm oddities, and the XFA fixtures behind `xfa_tohtml_spec.js` and `xfa_formcalc_spec.js`. | Geometry round-trip tests (X5), encryption (D3), viewing (V5). Fetch with `git clone --filter=blob:none --sparse` and `git sparse-checkout set test/pdfs`; resolve `.link` files only for the entries listed in `manifest.json`. |
| **IRCC forms** (canada.ca): IMM 5257, IMM 5257 SCH1 | Crown copyright; fetch, do not commit | Production LiveCycle/XFA forms that IRCC states must be opened in Adobe Acrobat Reader and may not open on tablets or phones. The definitive "degrade gracefully" case. | Acceptance test for D4: open, show the XFA notice, allow overlays, export. |
| **IRS fillable forms** (irs.gov): W-9, W-4, 1040 | US public domain | Widely used AcroForm forms with comb fields, radio groups, multiline text, and calculated fields. | Field type coverage (F1, F4, F5) on forms people actually receive. |
| **qpdf** `qpdf/qtest/qpdf/` | Apache-2.0 | Hundreds of edge-case files; the encryption subset covers RC4 40-bit and 128-bit, AES-128, AES-256, and owner-only versus user passwords. | D3 and E9. Only the encryption cases are fetched. |

`scripts/fetch-fixtures.sh` downloads each item in A.3 to `fixtures/fetched/`, verifies a recorded SHA-256 for each file, and fails loudly if a hash changes (IRCC and IRS re-issue forms without changing URLs). CI runs it with a cache keyed on the hash list.

### A.4 Generated fixtures

`scripts/make-fixtures.ts` uses pdf-lib to produce deterministic files for cases the public suites do not cover cleanly:

- Flat pages at `/Rotate` 0, 90, 180, 270, each with a registration mark at a known PDF coordinate (for X5).
- A page whose crop box origin is not (0, 0).
- An AcroForm with one of every supported field type, named predictably (`text1`, `multiline1`, `comb1`, `check1`, `radio1`, `dropdown1`, `list1`, `readonly1`).
- A 20-page, roughly 10 MB document with embedded images (for E7 and V6).
- A password-protected copy of the AcroForm fixture (user password `bogey`), produced with qpdf in the script since pdf-lib does not encrypt.

### A.5 Coverage matrix

Each row must be satisfied by at least one fixture in `manifest.json`; the test suite asserts this so a missing fetch is visible.

| Case | Expected fixture |
|---|---|
| Flat, single page | generated |
| Flat, multi-page, each rotation | generated, pdf.js |
| Non-zero crop box origin | generated, pdf-lib |
| AcroForm, every field type | generated, pdf-lib, IRS |
| AcroForm with comb and max-length | IRS W-9 |
| XFA, minimal | pdfium |
| XFA, production | IRCC IMM 5257 |
| Encrypted, user password, each cipher | qpdf, generated |
| Encrypted, owner password only | qpdf |
| Large document | generated |
| Real forms the developer receives | local |
