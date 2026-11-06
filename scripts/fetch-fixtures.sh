#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Downloads the fetched test fixtures (docs/REQUIREMENTS.md Appendix A.3) into the gitignored
# fixtures/fetched/ directory. These files are not redistributable (Crown copyright, bug-report
# PDFs) or simply too many to vendor, so they are fetched rather than committed.
#
#   scripts/fetch-fixtures.sh
#
# Every file is checked against the SHA-256 recorded below. A file already present with the right
# hash is skipped. A mismatch fails loudly with the path and both hashes: IRS and IRCC re-issue
# forms at the same URL, so a mismatch there usually means a new edition. Inspect it, then update
# the hash here and in fixtures/sources.json. GitHub sources are pinned to a commit SHA, so their
# hashes should never change. Attributes and passwords for each file are in fixtures/sources.json.
set -euo pipefail
cd "$(dirname "$0")/.."

out="fixtures/fetched"
pdfjs="https://raw.githubusercontent.com/mozilla/pdf.js/4986774652c3c59b9e2640df8abf24c94b7298d4/test/pdfs"
qpdf="https://raw.githubusercontent.com/qpdf/qpdf/4eba95899886e851cc41d76886483b347612f2a8/qpdf/qtest/qpdf"
irs="https://www.irs.gov/pub/irs-pdf"
ircc="https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms"

# Records: <path under fixtures/fetched>|<url>|<sha256>
files=(
  # IRS fillable AcroForm forms (US public domain). Re-issued at the same URL each tax year.
  "irs/fw9.pdf|$irs/fw9.pdf|2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53"
  "irs/fw4.pdf|$irs/fw4.pdf|92444d8856ce55d9e25dca8b6d1420634fc68b11e1ab1f760916ea29ddd312b2"
  "irs/f1040.pdf|$irs/f1040.pdf|3d31c226df0d189ced80e039d01cf0f8820c1019681a0f0ca6264de277b7e982"

  # IRCC dynamic XFA forms (Crown copyright; never commit). The URL carries the edition date
  # (dd-mm-yyyy); find the current one on the form's page under
  # https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/
  # (imm5257.html, imm5257-sch1.html).
  "ircc/imm5257e.pdf|$ircc/imm5257/01-11-2026/imm5257e.pdf|0dc03b24e7914a178ad29e2cfae811045835a1d36d7a3c35f040251d0aca562e"
  "ircc/imm5257_1e.pdf|$ircc/imm5257-sch1/01-09-2023/imm5257_1e.pdf|12486ea3d55d7cfa7ab88a915389c506dd76204b453d04c26cec0bf9ded75f93"

  # qpdf qtest encryption cases (Apache-2.0). Passwords are documented in qpdf/qtest/encryption.test.
  "qpdf/enc-R2,V1,U=view,O=master.pdf|$qpdf/enc-R2%2CV1%2CU%3Dview%2CO%3Dmaster.pdf|cbd0396c5af37a326cc829b3a031223accf5ea093119eaaa78bf4a386108ed14"
  "qpdf/enc-R3,V2,U=view,O=master.pdf|$qpdf/enc-R3%2CV2%2CU%3Dview%2CO%3Dmaster.pdf|5c0683d687e2e020fe172b1dcb7c29fe94f67bc40f038fee2391de610053fc16"
  "qpdf/enc-R3,V2,O=master.pdf|$qpdf/enc-R3%2CV2%2CO%3Dmaster.pdf|d0e64612cf946dd19e7421fa3ee17b466b54c8f164b1f95986f14d8ee8e02ba9"
  "qpdf/V4-aes.pdf|$qpdf/V4-aes.pdf|1d8a812844b8d8c7ba085a627eb3b7ab52aa651c6143ca07315084220a113240"
  "qpdf/c-r5-in.pdf|$qpdf/c-r5-in.pdf|19b6a33008141e1e898e1fac6e86524de0e8cd0c4643fdb01a1eb781e5cd8187"
  "qpdf/enc-XI-R6,V5,U=view,O=master.pdf|$qpdf/enc-XI-R6%2CV5%2CU%3Dview%2CO%3Dmaster.pdf|96b9262bfacf1358c7a68ab46c11563677e858888950237fdac8f3a227210edf"
  "qpdf/enc-XI-R6,V5,O=master.pdf|$qpdf/enc-XI-R6%2CV5%2CO%3Dmaster.pdf|63c99503fc9c6b44c47df124ce040d005e26d2c5d8d0999ad59c48b31a426863"

  # pdf.js test corpus (repository Apache-2.0; individual PDFs come from bug reports).
  "pdfjs/rotation.pdf|$pdfjs/rotation.pdf|5087c2afe763d145537d652bb3bc6c321ace3a267b2679ae2c178add3ba7f1d9"
  "pdfjs/issue14415.pdf|$pdfjs/issue14415.pdf|5487757b406d8970203818c8008969f868e23955650a81b193d0bbd2e6b99b60"
  "pdfjs/bug2082236.pdf|$pdfjs/bug2082236.pdf|3509af52c656c04ff98bac223646252b78cfb96fa0c2626ac3f74f907224f4aa"
  "pdfjs/issue16278.pdf|$pdfjs/issue16278.pdf|89da5db038b028242684ed2fa5044e7f0ce6527717cb794fbca043a99bae9146"
  "pdfjs/multiline.pdf|$pdfjs/multiline.pdf|a320198cf4bf28eaeb99080afcd92e5c2f864af1620b1b394a7bea44fb01c93c"
  "pdfjs/issue15893_reduced.pdf|$pdfjs/issue15893_reduced.pdf|3c2815853e6fe5c34feb76bb14402cbc46bbd484ecd57b672fc03577d0458ee8"
  "pdfjs/issue3371.pdf|$pdfjs/issue3371.pdf|0c3fb45d9b61ea762b4b3298c8c47e5375e83d151d356d87d740bcb85d953473"
  "pdfjs/issue6010_1.pdf|$pdfjs/issue6010_1.pdf|d7fd95e016b7d43bc9eed1041b0cdd6ee00e3dd902e50d0307b0a428782c543c"
  "pdfjs/issue21579.pdf|$pdfjs/issue21579.pdf|3b3d1db2aa4797e63d6dc7e48dc4f327c468144b93f80301771940230651da2e"
  "pdfjs/empty_protected.pdf|$pdfjs/empty_protected.pdf|69556af04215faec7da3e93e823c64f1b74679e52fd10379176f0e0462dd4b6c"
  "pdfjs/crypt_filters.pdf|$pdfjs/crypt_filters.pdf|19e6370432a3f4edb77900afb3e8d8d6a71344fe0912854781c391a506668d0a"
  "pdfjs/checkbox_no_appearance.pdf|$pdfjs/checkbox_no_appearance.pdf|31e82e933f4d4664c6ae1c4418cc44efce0c614c10c85c34b515b38e04e08bcd"
  "pdfjs/annotation-choice-widget.pdf|$pdfjs/annotation-choice-widget.pdf|2fcab2aed82afe9775359c1d166fb7aae77e99d25fe03be177e233d02d572538"
  "pdfjs/textfields.pdf|$pdfjs/textfields.pdf|f05e613732fbd3013578322e84a83925e98ffe522d2868a1f41485deb5855788"
)

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  echo "ERROR: need sha256sum or shasum." >&2
  exit 1
fi

failed=0 fetched=0 skipped=0
for record in "${files[@]}"; do
  IFS='|' read -r rel url expected <<<"$record"
  dest="$out/$rel"
  if [[ -f "$dest" && "$(sha256 "$dest")" == "$expected" ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  tmp="$dest.part"
  if ! curl --fail --silent --show-error --location --retry 3 --retry-delay 2 \
    --connect-timeout 20 --max-time 300 --output "$tmp" "$url"; then
    echo "ERROR: download failed: $dest" >&2
    echo "  url: $url" >&2
    rm -f "$tmp"
    failed=$((failed + 1))
    continue
  fi
  actual="$(sha256 "$tmp")"
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: SHA-256 mismatch: $dest" >&2
    echo "  url:      $url" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    rm -f "$tmp"
    failed=$((failed + 1))
    continue
  fi
  mv "$tmp" "$dest"
  fetched=$((fetched + 1))
  echo "fetched $dest"
done

echo "fixtures/fetched: $fetched fetched, $skipped already present, $failed failed."
if ((failed > 0)); then
  echo "ERROR: $failed fixture(s) failed; see above." >&2
  exit 1
fi
