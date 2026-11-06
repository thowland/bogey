// "pdf.js accepted the password, core rejected it" (spec §9.6). No fixture does this, but an
// unusual security handler could. The document is shown by pdf.js and exported as page images
// (spec §9.5), so it opens with a PdfInfo built from what pdf.js reports: `decryptable: false`, no
// fields (core could not read them), and each page's view box from its displayed size.
//
// pdf.js reports sizes with /Rotate already applied, so a rotated page is described here as an
// upright page of the same size. Overlays placed on it stay where they were put on screen; the
// page-image export renders the page as pdf.js shows it.
import type { PageGeometry, PdfInfo } from '@bogey/core';
import type { PdfDisplayDocument } from '../../pdfjs/types.ts';

/** pdf.js CSS px per PDF point at zoom 1 (spec §5.1). */
const CSS_PER_POINT = 96 / 72;

export async function pageImageInfo(display: PdfDisplayDocument): Promise<PdfInfo> {
  const pages: PageGeometry[] = [];
  for (let index = 0; index < display.pageCount; index++) {
    const { size } = await display.page(index);
    pages.push({
      index,
      view: [0, 0, size.width / CSS_PER_POINT, size.height / CSS_PER_POINT],
      rotate: 0,
      userUnit: 1,
    });
  }
  return {
    formType: 'flat',
    xfa: 'none',
    encrypted: true,
    decryptable: false,
    pageCount: display.pageCount,
    pages,
    fields: [],
    initialValues: {},
    metadata: {},
  };
}
