// Thumbnails (V2, spec §10.3): rendered at 120 CSS px wide when they scroll into view and kept as
// ImageBitmaps in an LRU of 60 per document. Evicted bitmaps are closed so their pixels are freed.
import { LIMITS } from '../../config.ts';
import { Lru } from '../../pdfjs/lru.ts';
import type { PdfDisplayDocument, PdfPage, RenderJob } from '../../pdfjs/index.ts';
import { canvasSize, releaseCanvas } from './canvasSize.ts';
import { PRIORITY, renderQueue } from './renderQueue.ts';

const caches = new WeakMap<PdfDisplayDocument, Lru<number, ImageBitmap>>();

export function thumbnailCache(display: PdfDisplayDocument): Lru<number, ImageBitmap> {
  let cache = caches.get(display);
  if (!cache) {
    cache = new Lru(LIMITS.thumbnailCache, (bitmap) => bitmap.close());
    caches.set(display, cache);
  }
  return cache;
}

/** Closes every thumbnail bitmap of a document that is no longer shown. */
export function dropThumbnails(display: PdfDisplayDocument): void {
  caches.get(display)?.clear();
  caches.delete(display);
}

/** The thumbnail's CSS size for a page. */
export const thumbnailSize = (page: PdfPage) => ({
  width: LIMITS.thumbnailWidth,
  height: (page.size.height * LIMITS.thumbnailWidth) / page.size.width,
});

/** Renders a thumbnail through the shared queue, behind the page in view. */
export function renderThumbnail(page: PdfPage): { promise: Promise<ImageBitmap>; cancel(): void } {
  const css = thumbnailSize(page);
  const pixels = canvasSize(css.width, css.height, window.devicePixelRatio, LIMITS.maxCanvasPixels);
  const canvas = document.createElement('canvas');
  const job: RenderJob = renderQueue.enqueue(
    () =>
      page.render(canvas, {
        zoom: LIMITS.thumbnailWidth / page.size.width,
        pixelWidth: pixels.width,
        pixelHeight: pixels.height,
        annotations: 'all',
      }),
    PRIORITY.thumbnail,
  );
  const promise = job.promise
    .then(() => createImageBitmap(canvas))
    .finally(() => releaseCanvas(canvas));
  return { promise, cancel: job.cancel };
}
