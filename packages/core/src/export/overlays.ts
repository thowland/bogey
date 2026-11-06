// Drawing overlays in the upright frame (spec §5.3, §9.1 step 3, E3, E5, G6). Each overlay is
// drawn at its anchor rotated counterclockwise by the page's /Rotate, so it reads upright on screen.
import {
  StandardFonts,
  degrees,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { uprightOffset } from '../geometry/index.ts';
import type { SignatureImage } from '../model/export.ts';
import type { PageGeometry } from '../model/geometry.ts';
import type { CheckOverlay, Overlay } from '../model/overlays.ts';
import { TEXT } from '../model/text.ts';
import { fail, ok, type Result } from '../result.ts';

/**
 * The ✓ is ZapfDingbats a20 (U+2714 in pdf-lib's ZapfDingbats encoding), drawn at font size
 * `size` and centred in the `size × size` box whose bottom-left is the anchor (spec §7.2, O4).
 * Fractions of the font size, from the glyph's AFM metrics.
 */
export const CHECK_GLYPH = Object.freeze({ char: '✔', advance: 0.846, inkHeight: 0.705 });

/** The X is two strokes inset by this share of the box, with this stroke width per point of size. */
export const X_MARK = Object.freeze({ inset: 0.15, strokePerPt: 0.1 });

const BLACK = rgb(0, 0, 0);

export interface OverlayDrawing {
  doc: PDFDocument;
  pages: readonly PDFPage[];
  geometry: readonly PageGeometry[];
  signatures: ReadonlyMap<string, SignatureImage>;
  /** Applied to every text and date string before drawing (E4 replacement). */
  text: (s: string) => string;
}

export type DrawProblem = {
  code: 'export.signature-missing' | 'export.failed';
  data?: Record<string, string>;
};

/** 1-based page numbers, for messages. */
const pageList = (pages: Iterable<number>) =>
  [...new Set(pages)]
    .sort((a, b) => a - b)
    .map((p) => String(p + 1))
    .join(', ');

export async function drawOverlays(
  overlays: readonly Overlay[],
  d: OverlayDrawing,
): Promise<Result<void, DrawProblem>> {
  const missing = overlays.filter(
    (o) => o.type === 'signature' && !d.signatures.has(o.signatureId),
  );
  if (missing.length > 0) {
    return fail({
      code: 'export.signature-missing',
      data: { pages: pageList(missing.map((o) => o.page)) },
    });
  }
  if (overlays.some((o) => d.pages[o.page] === undefined || d.geometry[o.page] === undefined)) {
    return fail({ code: 'export.failed', data: { reason: 'overlay-page' } });
  }

  const fonts = new Map<string, Promise<PDFFont>>();
  const font = (name: StandardFonts) => {
    let f = fonts.get(name);
    if (!f) {
      f = d.doc.embedFont(name);
      fonts.set(name, f);
    }
    return f;
  };
  // G6, E5: each signature image is embedded once and reused for every placement.
  const images = new Map<string, Promise<PDFImage>>();
  const image = (id: string) => {
    let img = images.get(id);
    if (!img) {
      img = d.doc.embedPng(d.signatures.get(id)!.png);
      images.set(id, img);
    }
    return img;
  };

  for (const overlay of overlays) {
    const page = d.pages[overlay.page]!;
    const rotate = d.geometry[overlay.page]!.rotate;
    const anchor = { x: overlay.x, y: overlay.y };
    switch (overlay.type) {
      case 'text':
      case 'date': {
        const f = await font(overlay.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
        const lines = d.text(overlay.text).split(/\r\n|\r|\n/);
        lines.forEach((line, i) => {
          if (line === '') return;
          const at = uprightOffset(rotate, anchor, 0, -i * TEXT.lineHeightFactor * overlay.size);
          page.drawText(line, {
            ...at,
            size: overlay.size,
            font: f,
            color: BLACK,
            rotate: degrees(rotate),
          });
        });
        break;
      }
      case 'check':
        if (overlay.glyph === 'check') {
          drawCheckGlyph(page, overlay, rotate, await font(StandardFonts.ZapfDingbats));
        } else {
          drawX(page, overlay, rotate);
        }
        break;
      case 'signature':
        page.drawImage(await image(overlay.signatureId), {
          ...anchor,
          width: overlay.width,
          height: overlay.height,
          rotate: degrees(rotate),
        });
        break;
    }
  }
  return ok(undefined);
}

function drawCheckGlyph(
  page: PDFPage,
  o: CheckOverlay,
  rotate: PageGeometry['rotate'],
  f: PDFFont,
) {
  const u = ((1 - CHECK_GLYPH.advance) * o.size) / 2;
  const v = ((1 - CHECK_GLYPH.inkHeight) * o.size) / 2;
  const at = uprightOffset(rotate, o, u, v);
  page.drawText(CHECK_GLYPH.char, {
    ...at,
    size: o.size,
    font: f,
    color: BLACK,
    rotate: degrees(rotate),
  });
}

function drawX(page: PDFPage, o: CheckOverlay, rotate: PageGeometry['rotate']) {
  const a = X_MARK.inset * o.size;
  const b = o.size - a;
  const thickness = X_MARK.strokePerPt * o.size;
  const p = (u: number, v: number) => uprightOffset(rotate, o, u, v);
  page.drawLine({ start: p(a, a), end: p(b, b), thickness, color: BLACK, lineCap: 1 });
  page.drawLine({ start: p(a, b), end: p(b, a), thickness, color: BLACK, lineCap: 1 });
}
