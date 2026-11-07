# Bogey – Implementation Plan

Status: Draft 1 · 2026-11-06
Implements: `docs/Bogey Technical Specification.md` (referred to below as "the spec")

The plan divides v1 into eleven sprints in five waves. Sprint 0 runs alone and puts the architecture, tooling and contracts in place. Each later wave runs up to three sprints at once, each in its own Claude Code session, git worktree and branch. The sprints in a wave own disjoint parts of the tree, so merging them back is mostly mechanical.

| Wave | Sprints (concurrent) | What you can review at the end |
| --- | --- | --- |
| 0 | S0 Foundations | The deployed shell at `bogey.beta-site.us`: layout, empty state, privacy note, production headers |
| 1 | S1 Viewer · S2 PDF core · S3 Signature capture | Open and page through any PDF on the Mac and the iPad; draw a signature with the Pencil and see it in the library; filled and flattened sample exports from the fixtures |
| 2 | S4 Overlays and export · S5 Form fields · S6 Documents and storage | **MVP**: fill a form or type on a flat page, place a signature, download a flattened PDF; reload without losing work; encrypted PDFs |
| 3 | S7 Snippets and settings · S8 Touch and iPad · S9 Offline and security | The full v1 feature set, offline after first load |
| 4 | S10 Release | v1.0.0, acceptance tests passed on the Mac and the iPad |

Wave 1 delivers a reviewable build. The MVP arrives at the end of wave 2, after three steps run in sequence, against eight if every sprint ran one after another.

---

## 1. Working agreement

### 1.1 Branches, worktrees and sessions

- `master` is the trunk. After the initial commit it receives only `--no-ff` merge commits from sprint branches, and nothing is committed to it directly.
- Before Sprint 0 branches, the initial commit on `master` contains `docs/` and a `.gitignore`, so the first sprint has a base to merge into.
- One branch per sprint, `sprint/NN-short-name`, created from the latest `master` when its wave starts. Fixes found after a merge go on `fix/…` branches and are merged the same way.
- Each concurrent sprint runs in its own worktree under `../bogey-worktrees/<branch-name>`, created with `scripts/worktree.sh start sprint/NN-name` (Sprint 0 adds it). The main checkout at `bogey/` stays on `master` and is where merges happen.
- One Claude Code session per worktree. A session works only inside its worktree and its sprint's owned paths (§1.4).
- The repository has no remote yet, so all merges are local. The CI workflow is written in Sprint 0 and starts running once a remote is added.

### 1.2 Exit gate (every sprint)

A sprint closes only when all of the following hold, in addition to the sprint's own exit criteria.

| # | Criterion | How it is checked |
| --- | --- | --- |
| G1 | All files are linted and lint passes | `pnpm lint`: ESLint (typescript-eslint, react, react-hooks, jsx-a11y, the banned-API rules from spec §11.2, no `.only`/`.skip`), Prettier check, dependency-cruiser boundary rules, `tsc --noEmit` for every package |
| G2 | At least 80% coverage for all code in the repository, not only the sprint's code | `pnpm test:coverage`: Vitest v8 coverage merged across projects, with global thresholds of 80 for lines, statements, functions and branches; the run fails below threshold |
| G3 | All tests pass, old and new | Unit, component, browser-mode and Playwright suites run in full. Obsolete tests may be deleted, but G2 must still hold afterwards |
| G4 | Playwright end-to-end tests from the MVP onward | The Sprint 0 smoke test runs from the start. From wave 2 (the MVP sprints) onward, every sprint adds end-to-end scenarios for what it delivered, run against the production build with the production headers |
| G5 | Development work is complete | The sprint's scope and its exit criteria are met |
| G6 | Production build succeeds | `pnpm build` |

`pnpm gate` runs G1, G2/G3, G6 and the Playwright suite in that order, with `pnpm audit` (spec §11.6) as part of lint.

### 1.3 Coverage rules

- Scope: `packages/*/src/**` and `apps/web/src/**`. Tests, fixtures, scripts, config files and generated files are excluded by pattern.
- Documented exclusions, as in Mulligan: `apps/web/src/main.tsx`, the two worker entry files' bootstrap lines, and `apps/web/src/sw/sw.ts` (exercised by Playwright, which does not feed coverage). Each exclusion carries a comment, and adding one must be stated in the merge message. `/* v8 ignore */` comments are not used.
- Sources: Node tests, jsdom component tests and Chromium browser-mode tests feed coverage. Firefox and WebKit browser-mode runs check that the engines agree but do not feed coverage, because v8 coverage is Chromium-only. Playwright does not feed coverage.
- Margin: each sprint aims for 85% or more, so that the second sprint in a wave to merge, or the deletion of an obsolete test, does not drop the merged result below 80%.
- Coverage is checked on the sprint branch after master has been merged into it and again on master after the merge (§1.5). A merge that drops the total below 80% is not completed.

### 1.4 File ownership in concurrent waves

Each sprint lists the paths it **owns** (creates and edits freely) and the shared files it may **touch** under stated rules. Anything else is read-only for that sprint. If a sprint finds it needs to change a file it does not own, it stops and asks, rather than editing and leaving the conflict for merge time.

Sprint 0 removes the usual sources of conflict before any concurrent work starts:

- **Dependencies are installed once.** Sprint 0 installs every runtime and dev dependency v1 needs (spec §10.1, plus `pdfjs-dist`, `@cantoo/pdf-lib`, `fast-check`), so `package.json` and `pnpm-lock.yaml` do not change during a wave. A dependency that turns out to be necessary mid-wave goes through a separate `chore/deps-…` branch merged to master; the sprints then merge master in.
- **Contracts are written first.** Core types (spec §4.1, `Overlay`, `Edit`, `PdfInfo`, `ExportInput`), store shapes, the core-bridge interface and the problem-code table are complete in Sprint 0, so concurrent sprints implement against fixed interfaces.
- **One store per file and one feature per directory.** `state/document.ts`, `view.ts`, `edits.ts`, `signatures.ts`, `snippets.ts` and `settings.ts` each belong to one sprint.
- **Layout slots.** `App.tsx`, the toolbar and the right panel compose components exported from each feature's `index.ts`. Sprint 0 creates every feature's `index.ts` with placeholder exports, so a sprint fills in its own feature without editing the layout.
- **Append-only shared files.** `ui/messages.ts` (problem codes and their text) and `e2e/helpers.ts` may only gain lines at the end of the section for the sprint's feature, which git merges cleanly or with trivial conflicts.
- **Ports per worktree.** `vite preview` and the Playwright server read their ports from `scripts/ports.mjs`, which derives them from the worktree path, so three sessions can run the gate at the same time.

### 1.5 Sprint close procedure

`scripts/close-sprint.sh sprint/NN-name <message-file>` runs the steps below; the message file holds the merge subject and summary, and the script appends the coverage line. It takes the merge lock before step 1, so the branch's gate always runs against the master it will merge into. Merges into `master` are serialized with a lock directory in the shared git directory (`$(git rev-parse --git-common-dir)/bogey-merge.lock`), so two sessions finishing together queue rather than collide.

```bash
# 1. In the sprint worktree: bring in whatever else has merged this wave
git merge master                       # resolve conflicts here, never on master
pnpm gate                              # must pass on the combined code

# 2. In the main checkout (bogey/, on master), holding the merge lock
git merge --no-ff sprint/NN-name -m "Merge sprint NN: <name>

<summary of delivered scope>
Coverage: L xx% / S xx% / F xx% / B xx%
<coverage-exclusion changes, if any, with reason>"
pnpm gate                              # re-run on master; must pass
git tag sprint-NN
pnpm deploy:site                       # deploys master to bogey.beta-site.us (refuses any other branch)

# 3. Release the lock; remove the worktree with scripts/worktree.sh finish sprint/NN-name
```

If the gate fails on `master` after the merge, the merge is reverted (`git reset --hard ORIG_HEAD`, before the lock is released and before anything is deployed), the fix is made on the sprint branch, and the close is run again. `master` is never patched directly.

Within a wave, sprints merge in the order they finish. The second and third to finish merge master into their branch first (step 1), which is where any integration work happens, on their own branch.

### 1.6 Review at the end of each sprint

Each sprint lists a **Review** script: what to open and what you should see. Each close deploys to `https://bogey.beta-site.us`, so reviews can happen on the Mac and on the iPad. `pnpm preview` serves the same build locally. A sprint closes once its gate passes. Your review feedback becomes the first items of the next sprint that owns the affected area, unless it shows a defect in what was delivered, in which case it is fixed on a `fix/…` branch first.

---

## 2. Sprint overview

| Sprint | Branch | Wave | Depends on | Theme | Size |
| --- | --- | --- | --- | --- | --- |
| 0 | `sprint/00-foundations` | 0 | – | Monorepo, tooling, gate, contracts, persistence base, fixtures, infrastructure, first deploy | L |
| 1 | `sprint/01-viewer` | 1 | S0 | Open, pdf.js under the production CSP, render, thumbnails, zoom, password prompt | M |
| 2 | `sprint/02-pdf-core` | 1 | S0 | Geometry, inspection, edits and undo, export, pdf worker, decryption spike | L |
| 3 | `sprint/03-signature-capture` | 1 | S0 | Image ops, draw dialog with Pencil pressure, upload with background removal, signature library | M |
| 4 | `sprint/04-overlays-export` | 2 | S1, S2, S3 | Overlay tools, selection and undo, signature placement, export dialog and download | L |
| 5 | `sprint/05-form-fields` | 2 | S1, S2 | Field controls, tab order, Fields panel, XFA notices | M |
| 6 | `sprint/06-documents-storage` | 2 | S1, S2 | Autosave and restore, recent documents, encrypted restore, clear everything, storage fallbacks | M |
| 7 | `sprint/07-snippets-settings` | 3 | wave 2 | Snippets, Today, field targeting, JSON import/export, settings, shortcuts help | M |
| 8 | `sprint/08-touch-ipad` | 3 | wave 2 | Pinch and wheel zoom, tap placement, coarse handles, memory bounds, iPad checklist | M |
| 9 | `sprint/09-offline-security` | 3 | wave 2 | Service worker, update toast, kill switch, security end-to-end suite | M |
| 10 | `sprint/10-release` | 4 | wave 3 | Accessibility, performance, acceptance tests, Help/About/Privacy, README, v1.0.0 | M |

Relative size: M is about one unit of work, L about one and a half. S2 and S4 carry the most technical risk (decryption, flattening, placement accuracy) and contain nothing unrelated.

### 2.1 Dependency map

```
            ┌─► S1 viewer ───────┐
S0 ─────────┼─► S2 pdf core ─────┼─► S4 overlays+export ─┐            ┌─► S7 snippets ──┐
            └─► S3 signatures ───┘   S5 form fields ─────┼─(MVP)──────┼─► S8 touch/iPad ┼─► S10 release
                                     S6 documents ───────┘            └─► S9 offline ───┘
```

S4 needs S3 only for signature placement. If S3 runs late, S4 can start without it and S4's placement work moves into S3's close (S3 merges master, then adds placement in its own feature directory), which keeps the wave moving.

### 2.2 MVP

The MVP is reached when S4 and S5 have both merged. It covers the spec's core path for an unencrypted document: open a flat or AcroForm PDF, fill its fields or place text, checks and dates, draw and place a signature, and download a flattened PDF. S6 usually merges in the same wave and adds saving, restore and encrypted documents, but the MVP does not wait for it. From wave 2 onward every sprint includes Playwright scenarios (G4).

---

## 3. Sprints

### Sprint 0 – Foundations

**Goal:** a repository in which the exit gate runs, the architectural boundaries are enforced from the first line of code, the contracts that the concurrent sprints build against are fixed, and a shell is deployed at `bogey.beta-site.us` with the production headers.

**Prerequisites:** `brew install qpdf` (used by `make-fixtures.ts` to produce the encrypted fixture), `pnpm exec playwright install chromium firefox webkit`, a `deploy.env` with the same AWS profile and hosted zone Mulligan uses.

**Scope**

- **Workspace and tooling** (spec §1, §3):
  - pnpm workspace with `packages/core`, `apps/web`, `tooling`; `tsconfig.base.json` strict; core with `lib: ["ES2022"]`, `types: []`.
  - Every v1 dependency installed and pinned (§1.4); `allowBuilds` allow-list.
  - ESLint flat config with the banned-API and banned-sink rules from spec §11.2, the `sw.ts` exception, no `.only`/`.skip`; Prettier; dependency-cruiser rules from spec §2.1, including "`pdfjs-dist` only in `src/pdfjs/`".
  - Vitest projects (`core:node`, `core:chromium|firefox|webkit`, `web:jsdom`, `web:chromium`, `tooling:node`), merged v8 coverage with thresholds at 80.
  - Playwright config serving the production build with the production headers; the CSP/Trusted Types violation fixture in `e2e/helpers.ts` (from Mulligan); one smoke spec.
  - Scripts: `dev`, `build`, `preview`, `lint`, `test`, `test:coverage`, `test:browsers`, `test:e2e`, `gate`.
  - `scripts/worktree.sh`, `scripts/ports.mjs` and `scripts/close-sprint.sh` (§1.1, §1.4, §1.5).
  - `.github/workflows/ci.yml` running the gate (live since the repository went public at github.com/thowland/bogey).
  - `tooling/test/boundaries.test.ts` proving each boundary rule rejects a planted violation.
- **Security baseline** (spec §11.3): `apps/web/security/headers.json`; the `vite preview` middleware serving them on every response including 304s; `security/trustedTypes.ts` with the default policy for the two worker URLs and `/sw.js`; the dev-only relaxed CSP.
- **Core contracts** (spec §4.1): all exported types (`Box`, `Point`, `PageGeometry`, `FieldDescriptor`, `FieldValues`, `Overlay`, `Edit`, `DocumentEditState`, `PdfInfo`, `ExportInput`, `ExportOutput`, `Problem` codes), `Result`, and the `TEXT` and date-format constants. No implementations beyond trivial helpers.
- **Web skeleton** (spec §10.2):
  - `App.tsx` with the U1 layout (toolbar, thumbnail strip, page area, collapsible right panel with Fields, Snippets and Signatures tabs) composed from each feature's `index.ts` placeholders.
  - Stores, one per file, with their full state shape and no-op actions: `document`, `view`, `edits`, `signatures`, `snippets`, `settings`.
  - `core-bridge/pdf.ts` interface (`inspect`, `exportPdf`) with a stub implementation that S2 replaces.
  - `config.ts` with every limit from spec §11.8; `ui/messages.ts` with every problem code from spec §10.4; the `ui/` primitives (Button, Dialog, Tabs, Toast, Banner, ErrorBoundary); design tokens copied from Mulligan; light and dark themes; Liberation Sans subset fonts.
  - Empty state (U5): drop-zone placeholder, empty recent list, the privacy paragraph.
- **Persistence base** (spec §10.5): `state/persistence.ts` with the version 1 schema (all five stores), typed accessors per store, the ordered write queue, the 3 s open timeout and in-memory fallback, and the fail-closed `deleteDatabase` routine. It is used by S3 and S6.
- **Fixtures** (requirements Appendix A, spec §14.2): `tooling/scripts/make-fixtures.ts` (rotations with registration marks, non-zero crop origin, every-field-type AcroForm, a hybrid XFA case if one can be generated, large document, encrypted copy through qpdf), `fetch-fixtures.sh` with SHA-256 verification, `manifest.json`, `LICENSES.md`, the vendored pdfium, pdf-lib and py-pdf selections, and `tooling/test/fixtures.test.ts` checking the A.5 coverage matrix.
- **Infrastructure and deploy** (spec §11.7): `infra/bogey.yaml` adapted from Mulligan's (with `GET`/`HEAD` only, logging off, unhashed `/pdfjs/*` and `sw.js` as `no-cache`), `tooling/test/infra.test.ts` holding the headers policy equal to `headers.json`, `infra-deploy.sh`, `deploy.sh` (refuses any branch but `master`), `check-live-headers.mjs`. Stack created and the shell deployed.
- **Repository docs:** `CLAUDE.md` (commands, workflow rules from this plan, architecture summary, security constraints), `LICENSE` (GPL-3.0-or-later), a short `README.md`.

**Tests**
- Boundary negative tests; coverage-matrix and manifest-hash tests; infra/headers equality test.
- Persistence: schema creation, write queue ordering, memory-mode fallback when opening fails, fail-closed delete (fake-indexeddb in jsdom, real IndexedDB in Chromium browser mode).
- Layout and empty-state component tests; Trusted Types policy accepts the allowed URLs and rejects others.
- Playwright smoke: the shell loads with zero CSP and Trusted Types violations in Chromium, Firefox and WebKit.

**Exit criteria**
- `pnpm gate` passes from a clean clone after `pnpm install --frozen-lockfile`.
- `check-live-headers.mjs` passes against `https://bogey.beta-site.us`.
- Two worktrees can run `pnpm gate` at the same time without port collisions.

**Review**
- Open `https://bogey.beta-site.us` on the Mac and the iPad: the layout appears with its empty panels, the empty state shows the privacy paragraph, light and dark follow the system setting.
- In the browser's developer tools, the response headers match spec §11.3.
- Run `scripts/worktree.sh start sprint/99-trial`, then remove it: the procedure for the waves works.

---

### Sprint 1 – Viewer

**Goal:** open any PDF and page through it, crisp on Retina and iPad screens, under the production CSP and Trusted Types.

**Owns:** `apps/web/src/pdfjs/`, `features/open/` (except `RecentDocuments`, which is S6's), `features/viewer/`, `state/document.ts`, `state/view.ts`, the Vite plugin that copies pdf.js assets to `/pdfjs/`.
**Touches:** `ui/messages.ts` (append, `open` and `viewer` sections); `e2e/helpers.ts` (append).

**Scope**
- **Early spike, first day:** pdf.js worker via `workerPort`, `getDocument` with the spec §10.3 options, rendering one page under the production headers in Chromium, Firefox and WebKit, with the violation fixture active. Record in the spec (§16.3 items 2–4) whether the pinned version uses WASM, whether `FontFace` loading raises violations, and which widgets `AnnotationMode.ENABLE_FORMS` omits. If Trusted Types or CSP blocks pdf.js in a way that needs a header change, stop and raise it, since `headers.json` belongs to S0's settled baseline.
- Drop zone and file picker, `%PDF-` header check, 50 MB and page-count limits (D1, D2).
- Password dialog driven by pdf.js `onPassword`, with retry and cancel; the password held in `state/document.ts` only (D3).
- Open pipeline in `features/open/openDocument.ts`: accept, read, call `core-bridge.inspect` (the S0 stub until S2 merges), load into pdf.js, set the document store. Written as an ordered sequence of named steps so that S6 can insert its persistence step in one place.
- Page rendering at `k × devicePixelRatio` with the 16.7 MP cap, cancellable render queue (two concurrent), CSS scaling during zoom changes (V1).
- Thumbnail strip with lazy rendering and an LRU (V2); page navigation with buttons and `[`/`]`.
- Zoom presets, fit width and fit page (V3); current page ± 1 rendered and others released (V6, basic form; S8 tunes it on the iPad).
- `/Rotate` honored in display (V5) through pdf.js viewports.
- Annotation mode chosen from `PdfInfo.formType` (spec §10.3).

**Tests**
- Component tests for the open flow (wrong type, too large, password retry and cancel) with a mocked pdf.js loader.
- Chromium browser-mode tests rendering the rotation fixtures and asserting canvas sizes and the pixel cap; WebKit run for divergence.
- Render queue cancellation and LRU tests.

**Exit criteria**
- Every fixture class in the manifest opens and renders except dynamic XFA, which renders its placeholder page.
- The 20-page, 10 MB fixture pages through without errors.

**Review**
- Drop each of these on the deployed site: a flat multi-page PDF, a rotated-page fixture, an IRS W-9, and the encrypted fixture (password `bogey`). Page through with the thumbnails and `[`/`]`, try every zoom preset.
- On the iPad: open a PDF from Files, check that text is sharp at 200%.

---

### Sprint 2 – PDF core

**Goal:** everything Bogey decides about a document, implemented and tested in `@bogey/core`, and running in the pdf worker: geometry, inspection, edits and undo, export.

**Owns:** `packages/core/src/geometry/`, `inspect/`, `history/`, `text/`, `export/`, `naming.ts` and their tests; `apps/web/src/workers/pdf.worker.ts`; `core-bridge/pdf.ts` (replacing the S0 stub) and any new `core-bridge/` module for history; `state/edits.ts`; `tooling/scripts/demo-export.ts`.
**Note:** inspection must load with `preserveXFA: true` (spec §6.2).
**Touches:** `packages/core/src/index.ts` (exports for owned modules); `fixtures/manifest.json` (append entries only).

**Scope**
- **Decryption spike, first day** (spec §9.6): load every qpdf encryption fixture and the generated encrypted fixture with `@cantoo/pdf-lib`, fill and flatten a field, save, check with pdf.js. Record the results in the spec. If the fork fails broadly, stop and bring the qpdf-WASM-versus-images decision back to the maintainer before continuing with encrypted export; the rest of the sprint goes ahead.
- Geometry (spec §5): `pageGeometry`, `viewSize`, the four conversions, widget rectangles with `/MK /R`, `screenDeltaToPdf`, `snapToGrid` (X1–X4).
- Inspection (spec §6.2, §6.3): form-type and XFA classification, field enumeration with flags, widget-to-page assignment, tab order, initial values, page geometry, metadata, encryption state and the decryption capability check.
- Edits and history (spec §7.3, §7.4): `applyEdit` with validation, `History` with coalescing and a 100-step limit; `state/edits.ts` wiring them to the document.
- Text (spec §7.2, §9.2): Helvetica metrics through pdf-lib, `layoutText`, auto font size matching pdf-lib's, `nonWinAnsi`, `formatDate`.
- Export (spec §9.1–§9.5): the full pipeline including hybrid XFA removal, the appearance check, flattening, overlays in the upright frame, signature embedding once per image, JavaScript and action stripping, metadata, unencrypted save, verification, the page-image fallback for undecryptable files, `preflightExport`, `outputFileName`.
- The pdf worker with comlink, timeouts, and replace-on-crash (spec §12).
- `pnpm demo:export`: writes filled and overlaid exports of each fixture class to `out/demo/` for review in Preview and Acrobat Reader.

**Tests**
- Geometry property tests, including agreement with pdf.js `PageViewport` (spec §14.3).
- Inspection against every manifest entry: expected form type, XFA kind, field count and kinds for the generated AcroForm and the IRS forms.
- History properties; edit validation properties; `outputFileName` and `nonWinAnsi` properties.
- Export verification (spec §14.4) in Node, including the X5 pixel sampling in Chromium browser mode.
- Worker host tests: timeout, crash and retry with a fake worker.

**Exit criteria**
- X5 passes for every rotation and the non-zero crop origin.
- Export of the 20-page, 10 MB fixture completes within 5 s in Node on the development machine.
- Decryption spike results are recorded in spec §9.6 and §16.3.

**Review**
- Run `pnpm demo:export` and open `out/demo/` in Preview and Acrobat Reader: field values appear flattened (clicking a field does nothing), overlay text sits on the registration marks on every rotated page, the encrypted fixture's export opens without a password, the hybrid XFA export shows the filled fields in Acrobat.

---

### Sprint 3 – Signature capture

**Goal:** draw signatures with a mouse, a finger or the Apple Pencil, upload a scanned signature with its background removed, and keep them in a library.

**Owns:** `packages/core/src/image/`; `apps/web/src/features/signatures/`; `state/signatures.ts`.
**Touches:** `packages/core/src/index.ts` (image exports); `ui/messages.ts` (append, `signatures` section).

**Scope**
- Core: `removeNearWhite` with Rec. 709 luminance and the 16-level ramp, `alphaBounds` (spec §8.2, §8.1).
- Draw dialog (spec §8.1): Pointer Events only, `touch-action: none`, pressure-driven width for pens, coalesced events, midpoint Bézier smoothing, touch ignored during a pen stroke, hover ignored, Clear/Cancel/Save, name and kind; trim with 8 px padding (G2, G3).
- Upload dialog (spec §8.2): decode with orientation and the 2,000 px cap, threshold slider, checkerboard preview, re-encode to PNG (G4, S9).
- Signatures panel: thumbnails grouped by kind, rename, delete with confirmation, "place" entry point that sets `view.tool = 'signature'` and the selected signature id (consumed by S4) (G1, G5).
- Persistence of the library through the S0 accessors, so signatures survive a reload even before S6.

**Tests**
- Image-op unit tests on synthetic RGBA buffers, and properties (monotone alpha, untouched dark pixels, bounds containment).
- Draw dialog component tests with synthetic pointer events (pen with pressure, mouse, touch, touch during pen); stroke width assertions on the recorded path model.
- Chromium browser-mode test: draw, save, read the PNG back, check transparency and trim.
- Upload tests with JPEG and PNG fixtures on white, and an oversized image.

**Exit criteria**
- A drawn signature and an uploaded signature both persist across reload in Chromium and WebKit browser mode.

**Review**
- On the iPad, draw a signature with the Pencil: the line should vary in width with pressure and keep up with the pencil, and resting your palm should leave no marks. Draw one with a finger.
- On the Mac, upload a phone photo of a signature on white paper, move the threshold slider, save. Reload: both appear in the Signatures panel.

---

### Sprint 4 – Overlays and export

**Goal:** type on any page, place checks, dates and saved signatures, move and resize them, undo mistakes, and download the result.

**Owns:** `apps/web/src/features/overlays/`, `features/export/`, the toolbar tool buttons and the undo/redo controls (exported from `features/overlays/index.ts`).
**Touches:** `ui/messages.ts`, `e2e/helpers.ts` (append); `features/signatures/` only to call the placement entry point if S3's close left it unconnected.

**Scope**
- Tool model and toolbar (O2, U2 subset: T, C, D, S, V, Esc, Cmd/Ctrl+Z and Shift+Z).
- Text and date overlays in a borderless textarea with the font-metric baseline, size and bold controls (O3, O5); check overlays (✓ path and X lines) (O4); signature overlays at 150 pt with locked aspect (O6).
- Selection frame, drag, resize, arrow nudges in screen directions, delete (O7), 1 pt snapping (O9), all through `state/edits.ts` with coalescing (O8).
- `lastPoint` recording for later snippet placement (spec §7.2).
- Export dialog (spec §9): preflight list with replace-and-continue (E4), the unencrypted-output notice (E9), progress after 500 ms (E7), the worker call, download with the generated name and delayed blob URL revocation (D8, E6).
- Cmd/Ctrl+S opens the export dialog.

**Tests**
- Component tests: placement, editing, selection, nudge directions on rotated pages, undo and redo across every edit kind, preflight list.
- Text baseline test in Chromium browser mode against the exported text position.
- **Playwright (MVP scenarios):** open a flat fixture, place text, check, date and a drawn signature, move and resize, undo and redo, export, verify the download with pdf-lib and pdf.js text extraction; on-screen versus exported position within 1 pt at 10 pt and 36 pt (acceptance 2); non-WinAnsi text triggers the preflight dialog.

**Exit criteria**
- The flat-document end-to-end scenario passes in Chromium, Firefox and WebKit.

**Review**
- On a flat or scanned PDF: type your name, add a check and today's date, place your saved signature and resize it, undo twice and redo, download. Open the file in Preview: everything sits where it was on screen, and nothing is editable.
- Repeat on the rotated-page fixture.

---

### Sprint 5 – Form fields

**Goal:** fill real form fields in place and export them flattened.

**Owns:** `apps/web/src/features/fields/` (field layer, field controls, Fields panel, document notices).
**Touches:** `ui/messages.ts`, `e2e/helpers.ts` (append).

**Scope**
- Field layer positioned with `widgetScreenRect`, scaled with zoom and rotated by the net widget rotation (F2, spec §5.4).
- Controls for text, multiline, comb, password, checkbox, radio, dropdown, editable combo and list; read-only and unsupported fields (F1, F4, F5, F8); auto font size; accessible names (U4).
- Field edits through `state/edits.ts`, coalesced per focus session (F3, O8).
- Tab order across mounted pages, continuing to the next page (F6).
- Fields panel with filter, current values and navigate-and-focus (F7).
- Notices for hybrid and dynamic XFA (D4, spec §6.2), shown from `PdfInfo`.
- A "Fills: ‹field›" focus signal published on `state/view.ts` through the setter S0 defined, for S7 to consume.

**Tests**
- Component tests for each control kind against descriptors, read-only behavior, comb spacing, tab order, the Fields panel.
- **Playwright (MVP scenarios):** open the every-field-type fixture, fill each type, tab through, use the Fields panel, place a signature, export, verify the flattened values and absence of fields; open the IRS W-9 and fill its comb fields; open the dynamic XFA fixture and see the notice; hybrid XFA fills.

**Exit criteria**
- With S4 merged (whichever closes second runs this): the combined MVP scenario, an AcroForm document filled, signed and downloaded, passes in all three engines.

**Review**
- On a W-9 from irs.gov: fill every field, check a box, place your signature, download and open in Acrobat Reader. The values look like the form's own text, and clicking a field does nothing.
- Use the Fields panel to jump to a field on page 2.

---

### Sprint 6 – Documents and storage

**Goal:** nothing is lost on reload, the recent list works, encrypted documents round-trip, and storage failures are handled.

**Owns:** `apps/web/src/state/session.ts`, `state/storage.ts`, `features/storage/` (the memory-mode banner), `features/open/RecentDocuments`, `features/settings/ClearEverything`, thumbnail generation for records.
**Touches:** `features/open/openDocument.ts` (inserting the persist step into S1's pipeline, nothing else); `ui/messages.ts`, `e2e/helpers.ts` (append).

**Scope**
- Persist bytes before inspection (D5); document records with page, zoom, field values and overlays; 500 ms debounce and immediate flush on hidden and `pagehide` (M1).
- Restore the active document on load, including the password prompt for encrypted documents, and graceful handling of missing records or bytes (D7, spec §10.5).
- Recent documents list with thumbnails, open and delete, the 20-document cap, and 30-day expiry (D6).
- Storage budget check with memory-only opening, `QuotaExceededError` handling, the memory-mode banner (M3); `navigator.storage.persist()` on first open (M4).
- Clear everything with one confirmation, fail-closed, reload (S7).
- First-save notice about data kept in this browser (spec §11.7).
- Migration table scaffolding with the version 1 schema.

**Tests**
- Session controller tests (fake-indexeddb): debounce, flush on hidden, ordering of bytes before record, restore, eviction, expiry, missing bytes, quota error, memory mode.
- **Playwright:** reload mid-edit restores page, zoom, values and overlays; closing and reopening the browser context restores; the encrypted fixture asks for its password after reload; 21 documents evict the oldest; clear everything leaves an empty app after reload.

**Exit criteria**
- Acceptance 3 (close mid-edit, reopen, everything restored) passes in Playwright in all three engines.

**Review**
- Fill half a form, close the tab, open the site again: you are back on the same page at the same zoom with your entries. On the iPad, switch to another app for a few minutes and come back.
- Open the encrypted fixture, fill it, reload: Bogey asks for the password, then restores your work.
- Use Clear everything: the recent list, signatures and snippets are gone.

---

### Sprint 7 – Snippets and settings

**Goal:** reusable personal details and the Today button, the settings Bogey needs, and the shortcut reference.

**Owns:** `packages/core/src/snippets/`; `apps/web/src/features/snippets/`; `features/settings/` (except `ClearEverything`); `state/snippets.ts`, `state/settings.ts`; the help dialog.
**Touches:** `ui/messages.ts`, `e2e/helpers.ts` (append).

**Scope**
- Core: snippet file schema, `parseSnippetFile`, `serializeSnippets`, `planSnippetMerge` (M2).
- Snippets panel with the seeded defaults, inline editing, dnd-kit reordering, delete, and the fixed Today button (N1, N3, N4).
- Fill the target field or place an overlay at `lastPoint` (N2), with focus kept by `preventDefault` on pointerdown and the "Fills:" target line.
- JSON export and import with the overwrite confirmation (M2).
- Settings: date format and default text size (O3, O5).
- Help dialog listing every shortcut (`?`), and the remaining shortcuts from U2 (Cmd/Ctrl+O where the browser allows it).

**Tests**
- Core snippet tests and the merge-idempotence property; malformed and oversized imports; `__proto__` labels.
- Component tests for the panel, reordering by keyboard, targeting.
- **Playwright:** fill a field from a snippet; place a snippet as an overlay; export and re-import the JSON; change the date format and place a date.

**Exit criteria**
- Acceptance 5's workflow (open, fill from snippets, sign from the library, export) runs end to end in Playwright.

**Review**
- Fill in your snippets, then complete a W-9 using only snippet buttons, your saved signature and Today. Time it against the one-minute target.
- Export the snippets, clear everything, import them back.

---

### Sprint 8 – Touch and iPad

**Goal:** Bogey works as well with a finger and the Pencil as with a mouse.

**Owns:** `apps/web/src/features/viewer/gestures/`, coarse-pointer styles, `docs/ipad-checklist.md`.
**Touches:** `features/viewer/PageView.tsx` (attaching the gesture handlers and render-memory changes); `features/overlays/SelectionFrame.tsx` (handle sizes and tap detection); `ui/messages.ts`, `e2e/helpers.ts` (append). These edits are limited to those files and those concerns.

**Scope**
- Pinch zoom: Safari gesture events with `preventDefault`, two-pointer tracking elsewhere, Ctrl+wheel on desktop, CSS transform during the gesture and re-render at the end; `touch-action: pan-x pan-y` on the scroll container (V4, spec §10.4).
- Tap versus pan detection for placement (spec §7.2).
- 44 × 44 handles on coarse pointers (O7).
- iPad memory: verify the canvas cap and page release on a real iPad with the large fixture, adjust thresholds in `config.ts`, add `page.cleanup()` for distant pages (V6).
- Layout below 1024 px: collapsible thumbnail strip and overlaid right panel (P3).
- `docs/ipad-checklist.md`: the manual checks for the Pencil, pinch, Files download, backgrounding and restore.

**Tests**
- Gesture reducer unit tests (scale from distance ratio, clamping, commit).
- **Playwright** with the iPad Pro descriptor in WebKit: pinch changes the app zoom and not the page scale; a pan places nothing; a tap places an overlay; handles measure at least 44 px; the narrow layout renders without errors at 800 px.

**Exit criteria**
- The iPad checklist is run on a real iPad against `bogey.beta-site.us` after the merge (plain HTTP over the LAN is not a secure context, so `crypto.randomUUID` is missing and documents do not open; the iOS Simulator on `localhost` works for quick checks). Anything that fails goes to a `fix/…` branch.

**Review**
- On the iPad: pinch to zoom a page without the toolbar zooming, pan around, tap to place text, drag a signature by its handle with a finger, open the 20-page fixture and page through it all without Safari reloading the tab.

---

### Sprint 9 – Offline and security

**Goal:** the site works offline after first load, and the security properties in spec §11 are proven by tests.

**Owns:** `apps/web/src/sw/`, the Vite service-worker plugin, `scripts/sw-kill.ts`, `e2e/security.spec.ts`, `e2e/offline.spec.ts`.
**Touches:** `main.tsx` (one registration call); `scripts/check-live-headers.mjs` (add `sw.js` and the workers); `ui/messages.ts`, `e2e/helpers.ts` (append).

**Scope**
- Service worker per spec §11.5: generated precache manifest, install, activate, cache-first fetch, navigation fallback, runtime caching of CMaps, `updateViaCache: 'none'`, the update toast with `skipWaiting` (S8, B7).
- Kill switch script and a documented procedure in `CLAUDE.md`.
- Security end-to-end suite (spec §14.5): request allow-list over a full session (S1), URL and hash injection, framing, `postMessage`, `text/uri-list` drag, the hostile-PDF fixture (OpenAction JavaScript, Launch action, link annotation) runs nothing and exports without JavaScript, renamed non-PDF refused, `__proto__` field name.
- Live header check extended to `sw.js`, both workers and their 304 revalidations.

**Tests**
- **Playwright:** offline after first load (`setOffline(true)`): open, fill, sign, export (acceptance 4); update flow (deploy a second build in the test server, see the toast, reload into the new version); the security suite.

**Exit criteria**
- With the network off on the iPad, a document can be opened from Files, filled and downloaded.

**Review**
- Load the site once, turn on airplane mode on the Mac and the iPad, open a PDF, fill it, download it.
- Open the network tab during a full session: only same-origin `GET`s appear.

---

### Sprint 10 – Release

**Goal:** v1.0.0, with the requirements' acceptance tests passed on a Mac browser and on the iPad.

**Owns:** `features/pages/` (Help, About, Privacy), `README.md`, release notes; fixes found by the passes below, each kept within the owning feature directory.

**Scope**
- Help, About (versions, build, canonical URL, license) and Privacy (what is stored, how to check the CSP, Clear everything) pages, written in Tim's voice with the `howland-voice` skill (U5, B8).
- Accessibility pass: axe in Playwright on every screen and dialog, keyboard-only walkthrough, VoiceOver on macOS and iPadOS (U4, spec §13).
- Performance: E7 on the reference laptop, open and render times for the large fixture; Playwright budget test on CI-equivalent settings.
- Cross-browser: the full Playwright suite in all three engines; manual run in Edge on Windows and Firefox on Linux if available.
- Acceptance tests 1–5 (requirements §15) on the Mac and the iPad, recorded in the release notes with dates and browser versions.
- `CLAUDE.md` updated with anything the waves taught us; the backlog written up (spec §15.3).

**Exit criteria**
- All five acceptance tests pass on both devices; axe reports no violations; tag `v1.0.0`.

**Review**
- Run the acceptance script yourself on the iPad with a real form that arrived by email.

---

## 4. Wave 1 outcomes and notes for wave 2

Wave 0 and wave 1 closed on 2026-11-06: `sprint-00`, `sprint-01`, `sprint-02`, `sprint-03`, plus `fix/live-check-post`, `chore/vitest-optimize-deps` and `chore/wave1-docs-bridges`. Spike results are in `docs/spikes/` and folded into the spec.

What wave 2 builds on, and what it must pick up:

- **Shared bridges.** `core-bridge/geometry.ts` and `core-bridge/text.ts` exist for S4, S5 and S7; extend them rather than adding parallel modules. `core-bridge/history.ts` backs `state/edits.ts`, which now has `seal()` and takes an edit context (fields and page count) on `load`.
- **Viewer state.** `state/document.ts` has `display` (the loaded pdf.js document) and `state/view.ts` has `renderedZoom` (the zoom actually shown, with fit-width and fit-page resolved). Overlay and field layers position themselves from `renderedZoom`.
- **S4**: `PdfBridge.exportPageImages` exists in core and the bridge; S4's export dialog uses it when `PdfInfo.decryptable` is false, supplying pages rendered by pdf.js with `rotation: 0` over the view box (spec §9.5).
- **S5**: the canvas leaves out every form widget except signature fields and push buttons, so the field layer draws all values, read-only ones included (F8). The notice for documents over 300 pages (spec §6.1) is S5's, alongside the XFA notices. Dropdown and list fields use native `<select>` (decided; spec §16.4): the E2E fixture ignores WebKit's report about its own control, so no workaround is needed. The IRS W-9 is a good end-to-end fixture: check that "Other" and 3b export checked.
- **S6**: inserts its persist step into `features/open/openSteps.ts` after `read`, with an `undo` that deletes the record; owns the "pdf.js accepted the password, core rejected it" case (route to page images, spec §9.6).
- **Test infrastructure.** Browser-mode tests list their dependencies in `vitest.config.ts` (`CORE_BROWSER_DEPS`, `WEB_BROWSER_DEPS`); a new import in a browser test needs an entry, or the post-merge gate on master reloads mid-run. WebKit reports a `style-src-elem` violation when Playwright takes a screenshot, so tests under the violation fixture take none. Worker progress callbacks are awaited in the worker, so stage order is deterministic.

### Wave 2 outcomes and notes for wave 3

Wave 2 closed on 2026-11-06 (`sprint-04`, `sprint-05`, `sprint-06`): the MVP is live, and reload, restore, the recent list and sealed edits for encrypted documents work.

- **S7** adds a **Close document** control to the toolbar (next to Open) that returns to the empty state and the recent list; today there is no way back to the list while a document is open. The session controller already stops tracking a document when it closes. S7 also reads `targetField` (set by S5) and places snippet overlays at `lastPoint` (set by S4).
- **S8** owns the viewer and overlay handle changes as planned; S4's overlay layer passes pointer events through to fields in select mode, so tap detection must keep that.
- **S9** precaches `/pdfjs/wasm/` and `/pdfjs/iccs/` (spec §11.5) and adds the hostile-PDF fixture.
- **S10** checks the page-image export (spec §9.5) on a rotated page by hand: pages are described from pdf.js's displayed sizes, so overlays on a rotated page may land off their on-screen position. No shipped fixture exercises it.
- `acroform-all.pdf` has a 51 pt font baked into `multiline1` by pdf-lib; regenerate it with a normal size when a sprint next touches fixtures.

### Wave 3 outcomes and notes for Sprint 10

Wave 3 closed on 2026-11-06 (`sprint-07`, `sprint-08`, `sprint-09`), followed by `fix/prune-unreferenced-objects` (exports no longer carry unlinked hostile objects) and `chore/wave3-docs-axe` (adds `@axe-core/playwright` for the accessibility pass).

- Two hands-on checks are left for the maintainer and belong to Sprint 10's acceptance run: `docs/ipad-checklist.md` on a real iPad, and airplane mode on the iPad (load once, go offline, open from Files, fill, download).
- The service worker's kill switch is documented in CLAUDE.md. While it is deployed the app re-registers it on each load, which is harmless; the next normal deploy replaces it.
- Concurrent sessions overwrote each other's logs in the shared scratchpad. Close and gate logs must use per-sprint names (`close-sprint-NN.log`).
- The page-image export on rotated pages still needs its manual check (wave 2 notes).

## 5. Running a wave

1. When a wave starts, the main checkout is on `master` with the previous wave fully merged and deployed.
2. Start one worktree per sprint: `scripts/worktree.sh start sprint/NN-name`. Open a Claude Code session in each, with the prompt: "Run Sprint NN of `docs/Bogey Implementation Plan.md`. Stay within the paths the sprint owns; ask before touching anything else."
3. Each session works to its exit criteria and runs `scripts/close-sprint.sh`, which waits for the merge lock if another session is merging.
4. The wave is complete when all of its sprints are tagged. Review feedback is assigned to the owning sprint of the next wave, or to a `fix/…` branch if it is a defect.

When a session discovers it needs a contract change (a new field on a core type, a new store action), the change goes to a small `chore/contract-…` branch merged to master by that session holding the merge lock, and the other sessions merge master in at their next convenient point. This should be rare, since Sprint 0 writes the contracts from the spec.

---

## 6. Risks

| Risk | Where it bites | Mitigation in the plan |
| --- | --- | --- |
| `@cantoo/pdf-lib` cannot decrypt some ciphers | S2 | First-day spike; the page-image fallback is already specified; a broad failure comes back to the maintainer before encrypted export is built |
| pdf.js conflicts with Trusted Types or the CSP | S1 | First-day spike against the production headers in three engines; the violation fixture is active in every Playwright test from S0 |
| On-screen and exported positions disagree | S2, S4 | Geometry written and property-tested against pdf.js `PageViewport` before any UI places anything; X5 pixel sampling and the 1 pt Playwright check |
| `flatten()` drops or misdraws fields in real forms | S2, S5 | The appearance check before flattening; IRS and pdf-lib fixtures in the export tests; Acrobat review in S2 and S5 |
| iPad Safari memory limits | S1, S8 | Canvas cap and page release from S1; real-device verification is an S8 exit criterion |
| Merge conflicts between concurrent sprints | Waves 1–3 | Dependencies installed once, contracts first, one store per file, layout slots, append-only shared files, owned-path lists, merge lock |
| Coverage drops when sprints combine | Every merge | 85% target per sprint; the gate runs again after merging master into the branch and after merging into master |
| Pointer pressure differs by browser and device | S3 | Pressure is only used for `pen`; mouse and touch use a constant width; the iPad review covers it |
