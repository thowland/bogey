# Bogey

A browser-only PDF fill-and-sign tool: open a PDF, fill in its form fields or type onto the page,
place a saved signature, and download a flattened copy. Nothing leaves the browser. Bogey is a
companion to [Mulligan](../mulligan) and is served from <https://bogey.beta-site.us>.

Status: Sprint 0 (foundations). The shell, tooling, contracts and hosting are in place; opening
documents arrives in wave 1. See `docs/Bogey Implementation Plan.md`.

## Development

pnpm workspace, Node 22 or later. First run:

```bash
pnpm install
pnpm exec playwright install chromium firefox webkit
brew install qpdf            # only to regenerate the encrypted fixture
pnpm fixtures:fetch          # optional locally: IRS, IRCC, qpdf and pdf.js test files
```

Day to day:

```bash
pnpm dev                     # dev server with a relaxed CSP for hot reload
pnpm build && pnpm preview   # the production build, served with the production headers
pnpm gate                    # everything a sprint must pass: lint, coverage, all tests, build, E2E
```

## Privacy

There is no backend. The site is static files on S3 behind CloudFront, and the Content Security
Policy in `apps/web/security/headers.json` limits the page to its own files and its own origin,
which accepts only `GET` and `HEAD` with access logging off. Documents, signatures and saved
details are kept in this browser's IndexedDB until you clear them. The design is in
`docs/Bogey Technical Specification.md` §11.

## License

GPL-3.0-or-later. The overlay font is Liberation Sans (SIL Open Font License 1.1).
