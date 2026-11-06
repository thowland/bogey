// Draws one page into a canvas inside `host` (V1, spec §10.3). Each render goes into a fresh
// canvas that replaces the old one only when it is complete, so during a zoom change the old
// canvas is stretched by CSS to the new size until the sharp one arrives. Superseded renders are
// cancelled, and canvases are released (set to 0 × 0) as soon as they are replaced or unmounted.
import { useEffect, useEffectEvent, useState, type RefObject } from 'react';
import { LIMITS } from '../../config.ts';
import { RenderCancelled, type AnnotationRendering, type PdfPage } from '../../pdfjs/index.ts';
import { canvasSize, releaseCanvas } from './canvasSize.ts';
import { renderQueue } from './renderQueue.ts';

export type PageCanvasStatus = 'waiting' | 'rendering' | 'ready' | 'failed';

const releaseAll = (host: HTMLElement) => {
  for (const canvas of host.querySelectorAll('canvas')) releaseCanvas(canvas);
  host.replaceChildren();
};

export function usePageCanvas(
  host: RefObject<HTMLElement | null>,
  page: PdfPage | null,
  zoom: number | null,
  annotations: AnnotationRendering,
  priority: number,
  canvasClass: string,
  maxPixels: number = LIMITS.maxCanvasPixels,
): PageCanvasStatus {
  const pixels =
    page && zoom !== null
      ? canvasSize(
          page.size.width * zoom,
          page.size.height * zoom,
          window.devicePixelRatio,
          maxPixels,
        )
      : null;
  const pixelWidth = pixels?.width ?? 0;
  const pixelHeight = pixels?.height ?? 0;
  // The status belongs to one render; a newer render reads as 'rendering' until it settles. A
  // neighbor that becomes current re-renders only if its canvas was capped smaller (V6).
  const renderKey =
    page && zoom !== null
      ? `${page.index}@${zoom}/${annotations}/${pixelWidth}x${pixelHeight}`
      : null;
  const [settled, setSettled] = useState<{ key: string; status: 'ready' | 'failed' } | null>(null);
  // A neighbor that becomes the current page keeps its render; only new renders take the priority.
  const currentPriority = useEffectEvent(() => priority);

  useEffect(() => {
    const target = host.current;
    if (!target || !page || zoom === null || renderKey === null) return;
    const canvas = document.createElement('canvas');
    canvas.className = canvasClass;
    canvas.setAttribute('aria-hidden', 'true');
    const job = renderQueue.enqueue(
      () =>
        page.render(canvas, {
          zoom,
          pixelWidth,
          pixelHeight,
          annotations,
        }),
      currentPriority(),
    );
    let live = true;
    job.promise.then(
      () => {
        if (!live) return releaseCanvas(canvas);
        releaseAll(target);
        target.append(canvas);
        setSettled({ key: renderKey, status: 'ready' });
      },
      (error: unknown) => {
        releaseCanvas(canvas);
        if (!live || error instanceof RenderCancelled) return;
        console.error(`Page ${page.index + 1} could not be drawn`, error);
        setSettled({ key: renderKey, status: 'failed' });
      },
    );
    return () => {
      live = false;
      job.cancel();
    };
  }, [host, page, zoom, annotations, canvasClass, renderKey, pixelWidth, pixelHeight]);

  useEffect(() => {
    const target = host.current;
    return () => {
      if (target) releaseAll(target);
    };
  }, [host]);

  if (renderKey === null) return 'waiting';
  return settled?.key === renderKey ? settled.status : 'rendering';
}
