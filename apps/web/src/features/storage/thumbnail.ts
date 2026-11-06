// The recent list's thumbnail (spec §6.1 step 6, D6): page 1 rendered by pdf.js at 200 px wide
// and stored on the document record as PNG bytes (an ArrayBuffer, never a Blob, spec §10.5).
import { LIMITS } from '../../config.ts';
import type { PdfDisplayDocument } from '../../pdfjs/types.ts';

function toPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/** Renders page 1 of `display`; null if the browser cannot produce the image. */
export async function recordThumbnail(
  display: PdfDisplayDocument,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<ArrayBuffer | null> {
  if (display.pageCount < 1) return null;
  const page = await display.page(0);
  const zoom = LIMITS.recordThumbnailWidth / page.size.width;
  const canvas = createCanvas();
  try {
    await page.render(canvas, {
      zoom,
      pixelWidth: LIMITS.recordThumbnailWidth,
      pixelHeight: Math.max(1, Math.round(page.size.height * zoom)),
      annotations: 'all',
    }).promise;
    const png = await toPng(canvas);
    return png ? await png.arrayBuffer() : null;
  } finally {
    // WebKit frees a canvas's backing store reliably only this way (spec §10.3).
    canvas.width = 0;
    canvas.height = 0;
  }
}
