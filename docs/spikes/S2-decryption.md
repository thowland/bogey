# Sprint 2 spike: decryption with `@cantoo/pdf-lib` 2.11.1

Status: done, 2026-11-06. For the main session to fold into spec §9.6 and §16.3 item 1.
Standing test: `tooling/test/fixtures-decryption.test.ts` (runs on every gate; fetched fixtures need `pnpm fixtures:fetch`).

## Method

For every encrypted entry in `fixtures/manifest.json`: `inspectPdf(bytes, { password })`, then `exportPdf` with a text overlay on page 1 and, where the document has an editable text field, that field filled; the field is flattened. The output is checked with pdf-lib (reloads without a password, no `/Encrypt` anywhere in the file, page count unchanged) and with pdf.js 6.5.438 legacy build in Node (opens without a password, `getTextContent` on page 1 contains the overlay, the field value, and the start of the original page's own text).

## Results

| Fixture | Cipher | Password | Result |
| --- | --- | --- | --- |
| qpdf `enc-R2,V1,U=view,O=master` | RC4-40 | user `view` | Pass |
| qpdf `enc-R3,V2,U=view,O=master` | RC4-128 | user `view` | Pass |
| qpdf `enc-R3,V2,O=master` | RC4-128 | owner only | Pass |
| pdf.js `issue15893_reduced` | RC4-128 | user `test` | Pass |
| pypdf `libreoffice-writer-password` | RC4-128 | user `openpassword` | Pass |
| qpdf `V4-aes` | AES-128 (V4) | owner only | Pass |
| pdf.js `issue3371` | AES-128 | user `ELXRTQWS` | Pass |
| IRCC `imm5257e`, `imm5257_1e` (dynamic XFA) | AES-128 | owner only | Pass |
| qpdf `c-r5-in` | AES-256 R5 | user `user3` | Pass |
| pdf.js `issue6010_1` | AES-256 | user `abc` | Pass |
| pdf.js `issue21579` | AES-256 R5 | user `pässwört` (non-ASCII) | Pass after a fix (below) |
| qpdf `enc-XI-R6,V5,U=view,O=master` | AES-256 R6 | user `view` | Pass |
| qpdf `enc-XI-R6,V5,O=master` | AES-256 R6 | owner only | Pass |
| pdf.js `empty_protected` | AES-256 R6 | owner only | Pass |
| generated `acroform-all-aes256` (qpdf) | AES-256 | user `bogey` | Pass, field filled and flattened |
| pdf.js `crypt_filters` | V4, mixed crypt filters (`/StmF` AESV2, `/StrF` RC4, `/Crypt` stream filters, Identity) | owner only | **Fails**: loads, but content decrypts to garbage. Routed to page images |

So the fork handles the qpdf matrix (RC4-40, RC4-128, AES-128, AES-256 R5 and R6, user and owner-only passwords, AES-256 owner-only included, which was §16.3's open question). It does not fail broadly; no qpdf-WASM decision is needed.

## Findings that changed the code

1. **Leftover `/Encrypt`.** After decryption the fork keeps the original's cross-reference streams as ordinary objects, and for files whose xref stream it tried to decrypt, as unparsed `PDFInvalidObject`s. Both still name `/Encrypt`, so a reloaded export looked encrypted to pdf-lib (readers use the real trailer and opened it). Export now removes xref-stream objects, unparsed objects naming `/XRef` or `/Encrypt`, and Standard-handler dictionaries before saving (`export/hygiene.ts`, `removeEncryptionLeftovers`). Verification rejects any output pdf-lib sees as encrypted.
2. **Non-ASCII AES-256 R5 passwords.** The fork encodes R5 passwords as Latin-1; R5 (like R6) wants UTF-8. `loadPdf` retries a non-ASCII password as its UTF-8 bytes, which opens `issue21579`.
3. **Silent wrong decryption.** `crypt_filters` loads without error. `inspectPdf` therefore runs a capability check after decrypting: no stream may still carry a `/Crypt` filter, and the first three pages' content streams must decode and read as content-stream text (90% printable in the first 512 bytes). A file that fails gets `PdfInfo.decryptable: false`; `exportPdf` returns `export.cannot-decrypt`, and the app should use `PdfBridge.exportPageImages` (spec §9.5), which core implements: each page as a JPEG rendered by pdf.js with `rotation: 0` over the view box, on a page with the original view box and `/Rotate`, overlays drawn on top.
4. **Damaged-file check after decryption.** Several encrypted files keep their page tree in an encrypted object stream, so the undecrypted structure has no pages; the "no pages means damaged" check runs on the decrypted document.

## Open points for the maintainer

- If pdf.js opens a file with a password that the fork rejects (none in the matrix after fix 2), `inspectPdf` reports `pdf.password-wrong`, and the open flow cannot tell that from a typo. The open flow (Sprint 1/6) could treat "pdf.js accepted, core rejected" as `decryptable: false` and use page images; that needs a `PdfBridge` change or an app-side rule, not a core change.
- Undecryptable files with their page tree inside an encrypted object stream report `pdf.damaged` (none in the fixtures).
