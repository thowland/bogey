// Page images for originals the pdf-lib fork cannot decrypt (spec §9.5). Core's exportPageImages
// wants each page as a JPEG of the unrotated page over its view box (pdf.js `rotation: 0`). The
// viewer's pdf.js wrapper renders pages as displayed, with /Rotate applied, so each page is
// rendered that way at 200 dpi and then turned back by the page rotation onto a second canvas.
import type { PageGeometry } from '@bogey/core';
import { LIMITS } from '../../config.ts';
import type { PageImage } from '../../core-bridge/pdf.ts';
import type { PdfDisplayDocument } from '../../pdfjs/index.ts';

/** spec §9.5: 200 dpi, where zoom 1 is 96 CSS px per inch. */
export const PAGE_IMAGE_ZOOM = 200 / 96;
export const JPEG_QUALITY = 0.9;

/** The canvas size for a page shown at `zoom`, scaled down to the per-canvas pixel limit. */
export function imageSize(
  displayed: { width: number; height: number },
  zoom: number,
  maxPixels: number = LIMITS.maxCanvasPixels,
): { width: number; height: number } {
  let width = displayed.width * zoom;
  let height = displayed.height * zoom;
  const over = (width * height) / maxPixels;
  if (over > 1) {
    width /= Math.sqrt(over);
    height /= Math.sqrt(over);
  }
  return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
}

/**
 * How to draw a page rendered as displayed (rotated clockwise by `rotate`) onto a canvas of the
 * unrotated page, `width × height`: translate, then rotate counterclockwise by `rotate`.
 */
export function unrotate(
  rotate: PageGeometry['rotate'],
  width: number,
  height: number,
): { dx: number; dy: number; radians: number } {
  switch (rotate) {
    case 0:
      return { dx: 0, dy: 0, radians: 0 };
    case 90:
      return { dx: 0, dy: height, radians: -Math.PI / 2 };
    case 180:
      return { dx: width, dy: height, radians: Math.PI };
    case 270:
      return { dx: width, dy: 0, radians: Math.PI / 2 };
  }
}

const release = (canvas: HTMLCanvasElement) => {
  // WebKit frees backing stores reliably only when the canvas is set to 0 × 0 (spec §10.3).
  canvas.width = 0;
  canvas.height = 0;
};

function toJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('The page image could not be encoded'));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/** Renders every page as an unrotated JPEG, one at a time to bound memory. */
export async function renderPageImages(
  display: PdfDisplayDocument,
  pages: readonly PageGeometry[],
  onPage: (index: number) => void = () => undefined,
): Promise<PageImage[]> {
  const images: PageImage[] = [];
  for (const geometry of pages) {
    onPage(geometry.index);
    const page = await display.page(geometry.index);
    const shown = imageSize(page.size, PAGE_IMAGE_ZOOM);
    const rendered = document.createElement('canvas');
    const flat = document.createElement('canvas');
    try {
      await page.render(rendered, {
        zoom: shown.width / page.size.width,
        pixelWidth: shown.width,
        pixelHeight: shown.height,
        annotations: 'all',
      }).promise;
      const quarter = geometry.rotate === 90 || geometry.rotate === 270;
      flat.width = quarter ? shown.height : shown.width;
      flat.height = quarter ? shown.width : shown.height;
      const context = flat.getContext('2d');
      if (!context) throw new Error('No 2D canvas context');
      // JPEG has no transparency: the page is white where pdf.js drew nothing.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, flat.width, flat.height);
      const t = unrotate(geometry.rotate, flat.width, flat.height);
      context.translate(t.dx, t.dy);
      context.rotate(t.radians);
      context.drawImage(rendered, 0, 0);
      images.push({ jpeg: await toJpeg(flat) });
    } finally {
      release(rendered);
      release(flat);
    }
  }
  return images;
}
