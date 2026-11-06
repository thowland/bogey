# Test fixture licenses

Every third-party file committed under `fixtures/vendored/` is listed below with its upstream
location (pinned to a commit), license and SHA-256. Attributes of each file (form type, XFA
kind, encryption, password, rotation, crop box, page count) are in `fixtures/sources.json`.
Files under `fixtures/vendored/generated/` are produced by `scripts/make-fixtures.ts` and are
part of this project. Files under `fixtures/fetched/` are downloaded by
`scripts/fetch-fixtures.sh`, are gitignored and are not redistributed (see the end of this file).

## Vendored files

| Path | Upstream | License | SHA-256 |
|---|---|---|---|
| `vendored/pdfium/simple_xfa.pdf` | <https://pdfium.googlesource.com/pdfium/+/03ad8222f16dd4a107c461d1e147c75cff60040c/testing/resources/simple_xfa.pdf> | BSD-3-Clause | `82e0af732b472b023b3c50940cac0d76b6a84c25dab2b4a8de79fd0a6b7cdb89` |
| `vendored/pdfium/xfa_combobox.pdf` | <https://pdfium.googlesource.com/pdfium/+/03ad8222f16dd4a107c461d1e147c75cff60040c/testing/resources/xfa/xfa_combobox.pdf> | BSD-3-Clause | `0ee96bdeb2dad02e3afbfc9b79960c89f63c5316732d913e6677fe3ffe9a92d9` |
| `vendored/pdfium/static_list_box_caption.pdf` | <https://pdfium.googlesource.com/pdfium/+/03ad8222f16dd4a107c461d1e147c75cff60040c/testing/resources/pixel/xfa_specific/static_list_box_caption.pdf> | BSD-3-Clause | `9b59127cc8a96009462cc5f771d78c1c32a74ff17866409ecb8865d77a676617` |
| `vendored/pdfium/static_password_field_rotate.pdf` | <https://pdfium.googlesource.com/pdfium/+/03ad8222f16dd4a107c461d1e147c75cff60040c/testing/resources/pixel/xfa_specific/static_password_field_rotate.pdf> | BSD-3-Clause | `464aa3780a3db1e001ead9fd14be46fd1a470bbfe4daf41f4e51ee6278ee13e3` |
| `vendored/pdfium/multiple_form_types.pdf` | <https://pdfium.googlesource.com/pdfium/+/03ad8222f16dd4a107c461d1e147c75cff60040c/testing/resources/multiple_form_types.pdf> | BSD-3-Clause | `cdff8afa99ed38cf602f13877d5be8d5aa4c9ed56b85e799349fece2bfeda129` |
| `vendored/pdfium/listbox_form.pdf` | <https://pdfium.googlesource.com/pdfium/+/03ad8222f16dd4a107c461d1e147c75cff60040c/testing/resources/listbox_form.pdf> | BSD-3-Clause | `4dd3b8b958eb56cb49afbb6b60b14b6d6ecba788181e088aa68be459fed10b49` |
| `vendored/pdf-lib/fancy_fields.pdf` | <https://github.com/Hopding/pdf-lib/blob/93dd36e85aa659a3bca09867d2d8fac172501fbe/assets/pdfs/fancy_fields.pdf> | MIT | `442669e40c4e2949e2f070c9714674988d01d8be070bd2d1d4c7e5bca16d9cfd` |
| `vendored/pdf-lib/form_to_flatten.pdf` | <https://github.com/Hopding/pdf-lib/blob/93dd36e85aa659a3bca09867d2d8fac172501fbe/assets/pdfs/form_to_flatten.pdf> | MIT | `fa71bff33bd6963e0e11b5fd37cf48b108a82c85cb2362ced60ea3548e8f0a40` |
| `vendored/pdf-lib/sample_form.pdf` | <https://github.com/Hopding/pdf-lib/blob/93dd36e85aa659a3bca09867d2d8fac172501fbe/assets/pdfs/sample_form.pdf> | MIT | `98a889d7640f8dbbd6b4a849436f1c64e80d5a8ef0a47d1388c2782f93d84a8a` |
| `vendored/pdf-lib/with_combed_fields.pdf` | <https://github.com/Hopding/pdf-lib/blob/93dd36e85aa659a3bca09867d2d8fac172501fbe/assets/pdfs/with_combed_fields.pdf> | MIT | `7850848531306d2897940a5a345973b6b3eac6fd52457c37187a9be0994d0824` |
| `vendored/pdf-lib/with_xfa_fields.pdf` | <https://github.com/Hopding/pdf-lib/blob/93dd36e85aa659a3bca09867d2d8fac172501fbe/assets/pdfs/with_xfa_fields.pdf> | MIT | `c0ce611fedd25b47b78ef8bc10a4f91c4382030f32f420e7f819f778bfb57ec1` |
| `vendored/pdf-lib/with_cropbox.pdf` | <https://github.com/Hopding/pdf-lib/blob/93dd36e85aa659a3bca09867d2d8fac172501fbe/assets/pdfs/with_cropbox.pdf> | MIT | `7e9f4cea69091a52c05b1567d1aa4b197f83b498ba483207ee556f95dc03dc54` |
| `vendored/pypdf/minimal-document.pdf` | <https://github.com/py-pdf/sample-files/blob/80d67b91f3e28909756ca7807bbe8f43b599d12f/001-trivial/minimal-document.pdf> | CC-BY-SA-4.0 | `f723638db6e763cf4ccadad38a3d38a02d9ecab95dab1f0bbf00e801991b5f92` |
| `vendored/pypdf/pdflatex-4-pages.pdf` | <https://github.com/py-pdf/sample-files/blob/80d67b91f3e28909756ca7807bbe8f43b599d12f/004-pdflatex-4-pages/pdflatex-4-pages.pdf> | CC-BY-SA-4.0 | `f17a09190ad8a04964d78115d8ba7fc7a298557274fa14932ba58612342b7dec` |
| `vendored/pypdf/habibi-rotated.pdf` | <https://github.com/py-pdf/sample-files/blob/80d67b91f3e28909756ca7807bbe8f43b599d12f/015-arabic/habibi-rotated.pdf> | CC-BY-SA-4.0 | `56329f1e3cff5358f1f2aadcfac03467cce51b36b2e2daab9c14cef26f7ea536` |
| `vendored/pypdf/cropped-rotated-scaled.pdf` | <https://github.com/py-pdf/sample-files/blob/80d67b91f3e28909756ca7807bbe8f43b599d12f/027-cropped-rotated-scaled/cropped-rotated-scaled.pdf> | CC-BY-SA-4.0 | `cc195eac510b81123de4f55ac9f8185f2120975a7b75a106460b98615737aacd` |
| `vendored/pypdf/libreoffice-writer-password.pdf` | <https://github.com/py-pdf/sample-files/blob/80d67b91f3e28909756ca7807bbe8f43b599d12f/005-libreoffice-writer-password/libreoffice-writer-password.pdf> | CC-BY-SA-4.0 | `3e333bff0196d0c5320f40cdd1b7a3abd21b316de79de3c0f9083accdaef9358` |
| `vendored/pypdf/libreoffice-form.pdf` | <https://github.com/py-pdf/sample-files/blob/80d67b91f3e28909756ca7807bbe8f43b599d12f/012-libreoffice-form/libreoffice-form.pdf> | CC-BY-SA-4.0 | `9105eeef8c8cafdb141b7edd768a5e08adffe320d1d4f89e1a7112a2b37d1c57` |

## pdfium (BSD-3-Clause)

Files in `vendored/pdfium/` are unmodified copies from PDFium `testing/resources/`, commit
`03ad8222f16dd4a107c461d1e147c75cff60040c` (<https://pdfium.googlesource.com/pdfium/>).

```
Copyright 2014 The PDFium Authors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## pdf-lib (MIT)

Files in `vendored/pdf-lib/` are unmodified copies from pdf-lib `assets/pdfs/`, commit
`93dd36e85aa659a3bca09867d2d8fac172501fbe` (<https://github.com/Hopding/pdf-lib>).

```
MIT License

Copyright (c) 2019 Andrew Dillon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## py-pdf/sample-files (CC-BY-SA-4.0)

Files in `vendored/pypdf/` are unmodified copies from py-pdf/sample-files, commit
`80d67b91f3e28909756ca7807bbe8f43b599d12f` (<https://github.com/py-pdf/sample-files>),
by the py-pdf/sample-files contributors. They are licensed under the Creative Commons
Attribution-ShareAlike 4.0 International License
(<https://creativecommons.org/licenses/by-sa/4.0/>). No changes were made. These files remain
under CC-BY-SA-4.0 and are not covered by this project's GPL-3.0-or-later license.

## Fetched sources (not redistributed)

`scripts/fetch-fixtures.sh` downloads these into the gitignored `fixtures/fetched/`, verifying a
recorded SHA-256 for each. They are listed in `fixtures/sources.json` and never committed.

| Directory | Source | License |
|---|---|---|
| `fetched/irs/` | <https://www.irs.gov/pub/irs-pdf/> | US government work, public domain |
| `fetched/ircc/` | <https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides.html> | Crown copyright |
| `fetched/qpdf/` | <https://github.com/qpdf/qpdf/tree/4eba95899886e851cc41d76886483b347612f2a8/qpdf/qtest/qpdf> | Apache-2.0 |
| `fetched/pdfjs/` | <https://github.com/mozilla/pdf.js/tree/4986774652c3c59b9e2640df8abf24c94b7298d4/test/pdfs> | Apache-2.0 (repository); individual PDFs come from bug reports |
