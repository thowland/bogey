// Previous and next page, the page number, and the `[` and `]` shortcuts (V3, U2). The page number
// is a polite live region, so page changes are announced (spec §13).
import { useEffect } from 'react';
import { useDocumentStore } from '../../state/document.ts';
import { useViewStore } from '../../state/view.ts';
import { Button } from '../../ui/Button.tsx';
import { pageStep } from './keys.ts';
import { clampPage } from './pageModel.ts';
import styles from './Controls.module.css';

export function PageControls() {
  const pageCount = useDocumentStore((state) =>
    state.status === 'ready' ? (state.display?.pageCount ?? 0) : 0,
  );
  const page = useViewStore((state) => state.page);
  const setPage = useViewStore((state) => state.setPage);

  useEffect(() => {
    if (pageCount === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const step = pageStep(event);
      if (step === 0) return;
      event.preventDefault();
      const view = useViewStore.getState();
      view.setPage(clampPage(view.page + step, pageCount));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pageCount]);

  if (pageCount === 0) return null;
  return (
    <div className={styles.group} role="group" aria-label="Page navigation">
      <Button
        variant="quiet"
        aria-label="Previous page"
        aria-keyshortcuts="["
        disabled={page <= 0}
        onClick={() => setPage(clampPage(page - 1, pageCount))}
      >
        ‹
      </Button>
      <span className={styles.label} aria-live="polite">
        Page {page + 1} of {pageCount}
      </span>
      <Button
        variant="quiet"
        aria-label="Next page"
        aria-keyshortcuts="]"
        disabled={page >= pageCount - 1}
        onClick={() => setPage(clampPage(page + 1, pageCount))}
      >
        ›
      </Button>
    </div>
  );
}
