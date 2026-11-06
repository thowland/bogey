// DOM measurement hooks for the viewer. Each falls back to a plain value where the browser API is
// missing (jsdom in tests).
import { useEffect, useState, type RefObject } from 'react';
import type { PdfDisplayDocument, PdfPage } from '../../pdfjs/index.ts';
import type { Size } from './zoom.ts';

/** The element's client size (inside borders, outside scrollbars), kept current. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setSize((previous) =>
        previous?.width === element.clientWidth && previous.height === element.clientHeight
          ? previous
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Whether the element is within (or near) its scroll container's visible area. */
export function useInView(ref: RefObject<HTMLElement | null>, margin = '200px'): boolean {
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin]);
  return inView;
}

/**
 * A page of the document once pdf.js has it, or null while it loads or if it cannot. Nothing is
 * loaded until `enabled`; once loaded, the page stays.
 */
export function usePage(
  display: PdfDisplayDocument,
  index: number,
  enabled = true,
): PdfPage | null {
  const [loaded, setLoaded] = useState<{ display: PdfDisplayDocument; page: PdfPage } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    display.page(index).then(
      (page) => {
        if (live) setLoaded({ display, page });
      },
      (error: unknown) => console.error(`pdf.js could not load page ${index + 1}`, error),
    );
    return () => {
      live = false;
    };
  }, [display, index, enabled]);
  return loaded && loaded.display === display && loaded.page.index === index ? loaded.page : null;
}
