// The page area (V1, V3, V4, V6, spec §10.3, §10.4): one page at a time, at the chosen zoom. The
// page on either side is rendered too, hidden and at a capped resolution, so paging is immediate;
// pages further away hold no canvas, and pdf.js frees what it holds for pages more than five away.
// Pinch, trackpad and Ctrl+wheel zoom are handled by gestures/.
import { useEffect, useRef } from 'react';
import { LIMITS } from '../../config.ts';
import type { AnnotationRendering, PdfDisplayDocument } from '../../pdfjs/index.ts';
import { useDocumentStore } from '../../state/document.ts';
import type { Zoom } from '../../state/persistence.ts';
import { useViewStore } from '../../state/view.ts';
import { FieldLayer } from '../fields/index.ts';
import { usePinchZoom } from './gestures/index.ts';
import { OverlayLayer } from '../overlays/index.ts';
import { useElementSize, usePage } from './hooks.ts';
import { annotationRendering, pagesAround } from './pageModel.ts';
import { PRIORITY } from './renderQueue.ts';
import { usePageCanvas } from './usePageCanvas.ts';
import { resolveZoom, type Size } from './zoom.ts';
import styles from './PageView.module.css';

export const PAGE_FAILED_TEXT =
  'This page could not be drawn. The rest of the document may still be readable.';

export function PageView() {
  const display = useDocumentStore((state) => state.display);
  const formType = useDocumentStore((state) => state.info?.formType);
  const page = useViewStore((state) => state.page);
  const zoom = useViewStore((state) => state.zoom);
  const area = useRef<HTMLDivElement>(null);
  const areaSize = useElementSize(area);
  usePinchZoom(area, zoom, display !== null);

  useEffect(() => {
    display?.releaseFar(page, LIMITS.cleanupDistance);
  }, [display, page]);

  if (!display) return null;
  const annotations = annotationRendering(formType);
  return (
    <div
      ref={area}
      className={styles.area}
      role="region"
      aria-label={`Page ${page + 1} of ${display.pageCount}`}
    >
      {areaSize &&
        pagesAround(page, display.pageCount, LIMITS.renderedNeighbors).map((index) => (
          <PageSheet
            key={index}
            display={display}
            index={index}
            current={index === page}
            zoom={zoom}
            area={areaSize}
            annotations={annotations}
          />
        ))}
    </div>
  );
}

interface PageSheetProps {
  display: PdfDisplayDocument;
  index: number;
  current: boolean;
  zoom: Zoom;
  area: Size;
  annotations: AnnotationRendering;
}

/**
 * One page: its canvas, and for the current page the field layer (S5) and overlay layer (S4) on
 * top. The sheet is `position: relative` and sized to the page at the rendered zoom, so the layers
 * position their contents in view-space CSS px from its top-left corner (spec §5.1).
 */
function PageSheet({ display, index, current, zoom, area, annotations }: PageSheetProps) {
  const page = usePage(display, index);
  const scale = page ? resolveZoom(zoom, page.size, area) : null;
  const setRenderedZoom = useViewStore((state) => state.setRenderedZoom);
  const host = useRef<HTMLDivElement>(null);
  const status = usePageCanvas(
    host,
    page,
    scale,
    annotations,
    current ? PRIORITY.current : PRIORITY.neighbor,
    styles.canvas!,
    current ? LIMITS.maxCanvasPixels : LIMITS.neighborCanvasPixels,
  );

  useEffect(() => {
    if (current && scale !== null) setRenderedZoom(scale);
  }, [current, scale, setRenderedZoom]);

  return (
    <div
      className={styles.sheet}
      hidden={!current}
      data-page={index + 1}
      data-status={status}
      style={
        page && scale !== null
          ? { width: page.size.width * scale, height: page.size.height * scale }
          : undefined
      }
    >
      <div ref={host} className={styles.canvasHost} />
      {status === 'failed' && (
        <p className={styles.failed} role="alert">
          {PAGE_FAILED_TEXT}
        </p>
      )}
      {current && (
        <>
          <FieldLayer />
          <OverlayLayer />
        </>
      )}
    </div>
  );
}
