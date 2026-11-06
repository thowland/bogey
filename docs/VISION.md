# Bogey — Vision

A browser-only PDF fill-and-sign tool. Open a PDF, type into its fields (or over its flat pages), drop a saved signature, download a flattened copy. Nothing leaves the browser.

Working name: Bogey — one over par, which is about the right level of ambition for a tool whose purpose is getting a dumb form over with. It is a companion to Mulligan, and the aim is to make completing forms less tedious rather than to build a better Acrobat.

## Motivation

A steady stream of PDF forms needs to be completed and signed and then emailed back. The available options each carry a cost we would rather not pay: DocuSign-style services route the document through a third party, Acrobat Pro is a subscription for what amounts to typing in boxes, and the free online editors are ad-supported and give no assurance about where the uploaded file ends up. The work is done from several machines (Mac, Windows, iPad) over the course of a day, so a single-platform desktop app does not fit either.

Mulligan established a pattern that fits: a static web app, hosted on S3 behind CloudFront, that does all of its processing in the browser and "downloads" the result. Bogey applies the same pattern to PDFs.

## Privacy posture

The design goal is that the document cannot leave the browser, and that this is verifiable rather than promised.

- No backend. The site is static files on S3 served through CloudFront. There is no API, no upload endpoint, no analytics, no third-party scripts, no ads.
- The Content Security Policy sets `connect-src 'none'` (or restricts it to `'self'` if a service worker needs it), `script-src 'self'`, `img-src 'self' blob: data:`, and `frame-ancestors 'none'`. With that header in place the page has no network path for a document to travel on, and anyone can confirm it from the response headers and the network tab.
- All library code is bundled and served from the same origin. No CDN-hosted dependencies.
- Working state (the current document, signatures, the snippet profile) lives in the browser's IndexedDB on that device only. There is no sync, and a visible "clear everything" control empties it.
- The site should function with the network disconnected once loaded. A service worker caching the app shell makes that literal, and it is a convenient demonstration of the point.

## Platforms

Current desktop browsers on Mac, Windows, and Linux (Chrome, Edge, Safari, Firefox), and Safari on iPad with touch input. Mobile phones are not a design target in v1, though nothing should actively break there.

Touch matters for two things: drawing a signature with a finger or Apple Pencil, and placing overlays on a page without a precise pointer. Apple Pencil capture is a stated requirement for the iPad, since a pencil-drawn signature is the one that will look like the real thing. Pinch-zoom on the page canvas should work, and tap targets for placed items should be comfortably large.

## Feasibility and stack

The pieces are mature and widely used.

| Concern | Library | License | Role |
|---|---|---|---|
| Rendering pages to screen | pdf.js (Mozilla) | Apache-2.0 | Rasterize each page to a canvas for display; expose the page geometry so screen coordinates map back to PDF points |
| Reading and writing the PDF | pdf-lib | MIT | Load the original bytes, read and fill AcroForm fields, draw text and images at arbitrary positions, flatten the form, serialize a new PDF — all in memory |
| Signature capture | `<canvas>` with pointer events (signature_pad or a small in-house equivalent) | MIT | Draw with mouse, finger, or stylus; export a transparent PNG |
| Persistence | IndexedDB (via a thin wrapper such as idb) | ISC | Store the working document, signatures, and snippets |
| UI | React + TypeScript, Vite build | — | Same toolchain as Mulligan |

pdf.js handles display and pdf-lib handles mutation; keeping those roles separate is the usual arrangement and avoids fighting either library. Password-protected PDFs are opened by pdf.js with a user-supplied password; pdf-lib can load most of them as well, and where it cannot, the fallback is to re-render the opened pages into a fresh document (which loses form fields and is flagged to the user).

## Two kinds of PDF

Roughly half of the forms encountered carry real AcroForm fields; the other half are flat pages (often scans or exports from Word) with boxes drawn on them. Bogey treats these differently and the user does not have to know which they have.

**Forms with fields.** On load, pdf-lib enumerates the fields (text, checkbox, radio, dropdown) and Bogey overlays an editable widget on each one, positioned from the field's rectangle on the rendered page. Typing fills the actual field value. Fonts, sizes, and alignment follow the field's own appearance settings where present. The user can still add free-floating overlays on top, since forms often lack a field where one is needed.

**Flat pages.** The user clicks (or taps) anywhere on a page to place a text overlay, a checkmark, a date, or a signature. Each overlay is a small object with a page index, a position in PDF points, and its content; it is drawn on the pdf.js canvas while editing and burned into the page by pdf-lib on export.

## v1 feature set

**Opening**
- Drag-and-drop or file picker; file is read with `FileReader` into a `Uint8Array` and never leaves memory or IndexedDB.
- Password prompt when the PDF is encrypted.
- Multi-page documents with a page thumbnail strip and the current page rendered at a zoom level the user controls.

**Filling**
- Native AcroForm field editing as described above.
- Free text overlays: single default font (Helvetica), size control, bold toggle, black ink. No font picker, no color picker.
- Checkmark overlay (an "X" or a check glyph) for boxes that are drawn rather than real.
- Date overlay with a one-click "today" in a configurable format.
- Overlays can be dragged to reposition, resized where it makes sense, and deleted.

**Signing**
- Draw a signature on a canvas with mouse, finger, or Apple Pencil; or upload a PNG/JPG and have it trimmed to its bounding box with the background made transparent where it is near-white.
- The signature canvas uses Pointer Events so Apple Pencil input arrives with pressure and is distinguished from touch; the canvas sets `touch-action: none` so Safari does not treat strokes as scroll gestures, and pressure can be used to vary stroke width for a more natural line. Palm rejection is left to iPadOS, which handles it when the Pencil is active.
- Signatures and initials are saved in IndexedDB and listed in a picker; one click places the chosen one on the page, where it can be dragged and scaled.
- Nothing cryptographic. The signature is an image placed on the page, which is the same thing a printed-signed-scanned form yields.

**Snippets**
- A small local profile of named text values (full name, address lines, phone, email, employer, and anything else the user adds).
- Each snippet is a button; clicking it places a text overlay containing that value at the last clicked position, or fills the focused AcroForm field.
- The profile is editable and exportable/importable as JSON so it can be moved between devices by hand.

**Saving**
- Download produces a flattened PDF: field values are rendered into the page content and the form fields are removed, and all overlays are drawn into the page. The output opens identically in any reader and the recipient cannot alter the entries by clicking into them.
- Output filename defaults to `<original>-signed.pdf`.
- The original file is retained in IndexedDB alongside the overlay state, so the user can return and produce a different version.

**Persistence and recovery**
- The current document, its field values, and its overlays are written to IndexedDB on every change. Reopening the site (after an accidental tab close, a reload, or an iPad backgrounding Safari) restores exactly where the user was.
- A "Clear everything" control wipes documents, signatures, and snippets, with a confirmation.

## Hosting and deployment

- Static build output in an S3 bucket, private, with CloudFront in front using Origin Access Control.
- CloudFront response headers policy carrying the CSP above, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a permissive but explicit `Permissions-Policy`.
- A single `index.html` with a hashed JS/CSS bundle; pdf.js's worker script is bundled and served from the same origin. Long cache lifetimes on hashed assets, short on `index.html`.
- Deployment is a sync to S3 and a CloudFront invalidation of `index.html`, run from a script or a GitHub Actions workflow with an OIDC role.
- A service worker caches the app shell so the site works offline after first load.

## Explicitly deferred to phase 2

- Merging PDFs (the one page operation that comes up regularly) and the related rotate, reorder, and delete-page operations. All are straightforward with pdf-lib and would slot in as a "Pages" panel.
- Typed signatures in a script font.
- Any form of sync between devices beyond manual JSON export of the snippet profile.
- Keeping the output as an editable (unflattened) form.
- Cryptographic or certified signatures, audit trails, or anything resembling 21 CFR Part 11.
- Mobile phone layout.

## Open questions to settle during the build

- Coordinate mapping between the pdf.js canvas (device pixels, top-left origin, possibly rotated pages) and pdf-lib (PDF points, bottom-left origin) is the one place that tends to produce off-by-a-few-points bugs; a small shared geometry module with tests is worth doing first.
- Font embedding: pdf-lib's standard 14 fonts cover ASCII and Latin-1 well; anything beyond that would require embedding a TTF, which is possible but adds weight. v1 assumes the standard fonts.
- Some AcroForm PDFs carry XFA forms rather than AcroForm; pdf-lib does not handle XFA. Those should be detected and treated as flat pages with a notice.
- IndexedDB storage quotas are generous on desktop and tighter on iPad Safari (and Safari may evict storage for sites not visited in a while). The app should handle a missing saved document gracefully rather than assuming it is there.

## Success criteria

Open a form that arrived by email, fill it in, sign it, and download the result in under two minutes, on whichever machine is nearest, without the file ever touching a server. The second time, with snippets and a saved signature, it should be well under one.
