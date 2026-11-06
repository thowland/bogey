// The thumbnail strip (V2): one button per page, drawn lazily as it scrolls into view. A
// thumbnail out of view gives up its canvas; the bitmap stays in the cache until evicted.
import { useEffect, useRef } from 'react';
import type { PdfDisplayDocument } from '../../pdfjs/index.ts';
import { RenderCancelled } from '../../pdfjs/index.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useViewStore } from '../../state/view.ts';
import { releaseCanvas } from './canvasSize.ts';
import { useInView, usePage } from './hooks.ts';
import {
  dropThumbnails,
  renderThumbnail,
  thumbnailCache,
  thumbnailSize,
} from './thumbnailCache.ts';
import styles from './Thumbnails.module.css';

export function Thumbnails() {
  const display = useDocumentStore((state) => state.display);
  const page = useViewStore((state) => state.page);

  useEffect(() => {
    if (!display) return;
    return () => dropThumbnails(display);
  }, [display]);

  if (!display) return null;
  return (
    <ol className={styles.list}>
      {Array.from({ length: display.pageCount }, (_, index) => (
        <li key={index}>
          <Thumbnail display={display} index={index} current={index === page} />
        </li>
      ))}
    </ol>
  );
}

interface ThumbnailProps {
  display: PdfDisplayDocument;
  index: number;
  current: boolean;
}

function Thumbnail({ display, index, current }: ThumbnailProps) {
  const setPage = useViewStore((state) => state.setPage);
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const inView = useInView(button);
  const page = usePage(display, index, inView || current);
  const size = page ? thumbnailSize(page) : null;

  useEffect(() => {
    if (current) button.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  useEffect(() => {
    const target = canvas.current;
    if (!target || !page || !inView) return;
    const draw = (bitmap: ImageBitmap) => {
      target.width = bitmap.width;
      target.height = bitmap.height;
      target.getContext('2d')?.drawImage(bitmap, 0, 0);
    };
    const cache = thumbnailCache(display);
    const cached = cache.get(index);
    if (cached) {
      draw(cached);
      return () => releaseCanvas(target);
    }
    const job = renderThumbnail(page);
    let live = true;
    job.promise.then(
      (bitmap) => {
        cache.set(index, bitmap);
        if (live) draw(bitmap);
      },
      (error: unknown) => {
        if (!(error instanceof RenderCancelled)) {
          console.error(`The thumbnail of page ${index + 1} could not be drawn`, error);
        }
      },
    );
    return () => {
      live = false;
      job.cancel();
      releaseCanvas(target);
    };
  }, [display, index, page, inView]);

  return (
    <button
      ref={button}
      type="button"
      className={styles.thumb}
      aria-label={`Page ${index + 1}`}
      aria-current={current ? 'page' : undefined}
      onClick={() => setPage(index)}
    >
      <canvas
        ref={canvas}
        className={styles.canvas}
        aria-hidden="true"
        style={size ? { width: size.width, height: size.height } : undefined}
      />
      <span className={styles.number}>{index + 1}</span>
    </button>
  );
}
