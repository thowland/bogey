# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Bogey is a browser-only PDF fill-and-sign tool: open a PDF, fill its form fields or type over flat pages, place a saved signature, and download a flattened copy. Nothing leaves the browser. It is a companion to Mulligan (`../mulligan`) and follows its structure, toolchain and security posture; when something is not covered here or in the spec, do it the way Mulligan does.

## Documents

- `docs/VISION.md` and `docs/REQUIREMENTS.md`: what v1 must do. Requirement IDs (D1, F3, X5, …) are cited in code comments, tests and commits.
- `docs/Bogey Technical Specification.md`: how it is built. Spec §-references in code comments point here. §16 lists every departure from the requirements.
- `docs/Bogey Implementation Plan.md`: the sprints, waves, owned paths, exit gate and close procedure. When asked to run a sprint, follow its section exactly.

## Status

Pre-Sprint 0: only the docs exist. Sprint 0 creates the workspace, tooling and scripts listed below; until then, the commands in this file do not exist yet. Update this section and the commands as sprints land.

## Commands (from Sprint 0)

pnpm workspace, Node 22+. First run needs `pnpm exec playwright install chromium firefox webkit`; fixture generation needs `qpdf` (`brew install qpdf`).

```bash
pnpm dev                       # Vite dev server (relaxed dev CSP for HMR)
pnpm build && pnpm preview     # production build served with the production headers
pnpm lint                      # eslint + prettier --check + dependency-cruiser + typecheck + pnpm audit
pnpm test:coverage             # Vitest, merged coverage, thresholds 80% on all four metrics
pnpm test:e2e                  # Playwright against the production build
pnpm gate                      # lint → test:coverage → test:browsers → build → test:e2e
pnpm demo:export               # (Sprint 2) filled/overlaid exports of each fixture class into out/demo/
pnpm infra:deploy              # create/update the CloudFormation stack (infra/bogey.yaml)
pnpm deploy:site               # gate, build, publish master to bogey.beta-site.us, check live headers

scripts/fetch-fixtures.sh      # download fetched fixtures, verify SHA-256
scripts/worktree.sh start|finish sprint/NN-name
scripts/close-sprint.sh sprint/NN-name
```

Vitest projects: `core:node`, `core:chromium|firefox|webkit`, `web:jsdom`, `web:chromium`, `tooling:node`.

## Workflow rules

- `master` is the trunk and receives only `--no-ff` merges. Every unit of work is on its own branch: `sprint/NN-…`, `fix/…`, `feature/…`, `chore/…`, `docs/…`. Never commit to `master` directly, and never patch it after a failed merge; fix on the branch and merge again.
- Concurrent sprints run in separate worktrees under `../bogey-worktrees/`, one Claude session each. A session edits only the paths its sprint owns (plan §1.4 and the sprint's **Owns**/**Touches** lists) and asks before touching anything else. `ui/messages.ts` and `e2e/helpers.ts` are append-only within the sprint's section.
- `package.json` and `pnpm-lock.yaml` do not change during a wave. A needed dependency or contract change goes through its own `chore/…` branch merged to master.
- Exit gate for every sprint: `pnpm gate` passes, meaning lint is clean, all tests pass (old and new), and global coverage is at least 80% for lines, statements, functions and branches (aim for 85%). Playwright scenarios are required for every sprint from wave 2 (the MVP) on.
- Close a sprint with `scripts/close-sprint.sh`: merge master into the branch, gate, take the merge lock, `--no-ff` merge with coverage figures in the message, gate on master, tag `sprint-NN`, `pnpm deploy:site`.
- Coverage exclusions are limited to `main.tsx`, worker bootstrap lines and `sw.ts`; adding one must be stated in the merge message. No `/* v8 ignore */`.
- Deploy settings (AWS profile, hosted zone) live in the gitignored `deploy.env`; `deploy.env.example` documents them. The CloudFront headers policy in `infra/bogey.yaml` must stay equal to `apps/web/security/headers.json` (enforced by a test). Deploys run only from `master`.
- Docker, if ever needed, follows the global naming and label rules (`bogey-<env>-<role>-<dddd>`, `dev.project=bogey`).
- User-facing documentation (Help, About and Privacy pages, README) is written in Tim Howland's voice. Use the `howland-voice` skill.
- Commit only when asked.

## Architecture

- **`packages/core` (`@bogey/core`)**: every decision about a document, with no DOM, Node or pdf.js dependency (`lib: ES2022`, `types: []`). Geometry (spec §5), inspection and field enumeration (§6), edits and undo (§7), signature pixel ops on RGBA buffers (§8), export (§9), snippet import (§10.6). Runtime dependencies: `@cantoo/pdf-lib` and `zod` (run `jitless: true`). Returns `Result` with typed problems; throws only on programmer error.
- **`apps/web` (`@bogey/web`)**: React 19 + Vite + zustand.
  - `pdfjs-dist` may be imported only in `src/pdfjs/`; pdf.js is used for display only.
  - Core runtime code is reached only through `src/core-bridge/` and `src/workers/pdf.worker.ts` (comlink). Type imports from `@bogey/core` are fine anywhere.
  - One zustand store per file in `src/state/`, each owned by one sprint.
  - `state/persistence.ts` owns IndexedDB (`bogey` database); original PDF bytes live in their own `documentBytes` store.
  - App limits live in `src/config.ts`; problem codes and their user text in `src/ui/messages.ts`.
- Coordinates: overlays store an anchor in unrotated PDF points and dimensions in the upright (as-viewed) frame; export draws with `rotate = page /Rotate` (spec §5.3).

## Security constraints

The site is public with no backend; documents, signatures and snippets never leave the device (spec §11).

- Production headers are defined once in `apps/web/security/headers.json`: CSP with `connect-src 'self'` (pdf.js assets and the service worker only), `script-src 'self' 'wasm-unsafe-eval'`, no inline styles, Trusted Types with a `default` policy allowing only the two worker URLs and `/sw.js`, plus COOP/COEP/CORP. `vite preview` serves them minus HSTS and `upgrade-insecure-requests`, on every response including 304s.
- CloudFront allows only `GET`/`HEAD`, with access logging off.
- ESLint bans `fetch`, XHR, WebSocket, EventSource, `sendBeacon`, `location.search`/`location.hash`, `message` listeners on `window`, `window.open`/`opener`, and HTML sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`). `src/sw/sw.ts` is the one file allowed to fetch.
- pdf.js runs with `isEvalSupported: false`, no scripting, no XFA rendering and no annotation layer. Field names, values, file names and snippet labels are rendered as text only and looked up with `Object.hasOwn` or `Map`.
- Input arrives only through user gestures (drop, file picker, typing, the signature canvas, snippet import). There is no URL-driven state.
- Export strips document JavaScript and additional actions and saves unencrypted. Passwords are never persisted.
