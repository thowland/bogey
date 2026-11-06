# Changelog

This file records every notable change to the project, one section per release.

## 1.0.0 — First release (2026-11-06)

The first release deployed to https://bogey.beta-site.us, built over sprints 0 to 10 of the [implementation plan](docs/Bogey%20Implementation%20Plan.md) and the fixes that followed. The automated acceptance tests pass in Chromium, Firefox and WebKit; the device acceptance on a Mac and an iPad (`docs/manual-acceptance.md`) is recorded at the end of this entry once it has been run, and the `v1.0.0` tag follows it.

### Opening and viewing

- Open a PDF by dropping it or with the file picker, up to 50 MB and 2,000 pages, with a header check before anything parses it. Password-protected files ask for their password, which is held in memory only.
- Pages render with pdf.js under the production security policy, one page at a time with thumbnails, ten zoom presets, and pinch, Ctrl+wheel and trackpad zoom that change Bogey's zoom rather than the browser's.
- Adobe XFA forms are detected and explained; a hybrid form is filled through its ordinary fields, and a dynamic one can still be typed over and signed.

### Filling and signing

- Every AcroForm field type gets a real form control over the page, in the form's tab order across pages, with a Fields panel that lists, filters and jumps to fields.
- Text, check marks and dates can be placed anywhere on a page, moved, resized, nudged with the arrow keys, deleted, and undone and redone up to 100 steps. A placement tool chosen from the keyboard shows a marker where Enter will place the item.
- Signatures and initials are drawn with a mouse, a finger or an Apple Pencil, whose pressure sets the line width, or uploaded from a photo with the paper removed, and kept in a library.
- Snippets hold the details typed on every form and fill the focused field or become text on the page; Today places the date in the chosen format. Snippets export to and import from a JSON file.

### The signed copy

- Download writes field values and overlays into the page, flattens the form, removes document JavaScript, additional actions and other active content, drops any password, and checks the copy before saving it as `name-signed.pdf`. Characters the standard font cannot write are listed first, with the choice to replace them.
- Originals that pdf.js can show but pdf-lib cannot decrypt are exported from images of their pages after a warning. This was checked on rotated pages, by both routes that lead to it, with overlays landing within 1 pt of their place on screen.
- E7: the 20-page, 10 MB fixture exports in 67 to 101 ms in the three engines under Playwright (budget 10 s), and opening it and rendering its first page takes 0.4 to 0.7 s. The export itself, run once in Node 24 on a MacBook Pro with an Apple M4 Pro, takes 23 ms (17 ms on later runs). The 5 s figure for the 2020-era reference laptop is a manual check in `docs/manual-acceptance.md`.

### Keeping work

- Work is saved in the browser as it is done and comes back after a reload or a closed browser, with the last 20 documents in a recent list. Documents unchanged for 30 days are deleted.
- What is typed into a password-protected document is stored encrypted under a key derived from its password, which is never stored.
- Private windows and browsers that refuse storage fall back to working in memory with a notice. Clear everything deletes the database and never reports success unless the browser confirmed it.

### Offline and updates

- A service worker stores the application on the first visit, so Bogey loads and works without a connection afterwards, including the PDF viewer's fonts and decoders.
- A new version waits until the user accepts "A new version is ready. Reload to update." A kill switch can withdraw a bad build from visitors' caches.

### Help, accessibility and documentation

- Help, About and Privacy pages. Privacy lists what is stored and where, explains how to check the security policy in the network tab, and carries Clear everything.
- An axe scan (WCAG 2.2 AA) of every screen and dialog in three engines reports no violations, and a keyboard-only session from opening to downloading is tested end to end. Fixes from that pass: snippet and Fields panel buttons are named by their visible text, the snippet editing list is well formed, the overlay delete button is 24 px, a zoomed page can be scrolled from the keyboard, and focus returns to a sensible control after a placement, an Escape or a delete.
- A README, this changelog, and `docs/manual-acceptance.md` with the Mac, iPad and VoiceOver steps.

### Security and hosting

- A strict Content Security Policy with `connect-src 'self'`, Trusted Types, cross-origin isolation and the other production headers, defined once and applied identically by the preview server and the CloudFront response headers policy, 304 responses included. Every end-to-end test fails on any violation.
- No URL-driven state, no cross-window messages, no network APIs in application code, and an end-to-end allow-list of the requests a whole session makes.
- Hosting on a private S3 bucket behind CloudFront that accepts only GET and HEAD, with logging off, a WAF rate rule and a budget alarm, provisioned by `infra/bogey.yaml`, with a deploy that runs the full gate and checks the live headers.

### Fixed before release

- Exports no longer carry the unreferenced objects pdf-lib wrote for actions that had been stripped.
- The `acroform-all.pdf` fixture's multi-line field has a 10 pt font; it had a 51 pt size from pdf-lib's automatic sizing.

### Acceptance

| Test | Automated (Chromium, Firefox, WebKit) | Mac | iPad |
| --- | --- | --- | --- |
| 1. Password-protected form, every field, Pencil signature | Pass, all three | | |
| 2. Flat scanned page within 1 pt | Pass, all three | | |
| 3. Close mid-edit and restore | Pass, all three | | |
| 4. No requests after the shell loads; offline | Pass, all three | | |
| 5. Second form under a minute | Pass, all three | | |

Mac and iPad results, with dates and browser versions, are added from `docs/manual-acceptance.md`.
