// The recent documents list (D6, spec §10.4): name, page count, last change and a thumbnail of
// page 1, with open and delete. Thumbnails are shown through blob URLs that are revoked when the
// list stops showing them (spec §11.7).
import { useEffect, useRef } from 'react';
import { deleteSaved, openSaved } from '../storage/start.ts';
import type { DocumentRecord } from '../../state/persistence.ts';
import { useSessionStore } from '../../state/session.ts';
import { Button } from '../../ui/Button.tsx';
import styles from './RecentDocuments.module.css';

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Page 1 through a blob URL, revoked when no longer shown (spec §11.7). */
function Thumbnail({ png }: { png: ArrayBuffer | null }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!png || !img) return;
    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    img.src = url;
    return () => {
      img.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [png]);
  return png ? (
    <img ref={ref} className={styles.thumb} alt="" />
  ) : (
    <span className={styles.thumb} aria-hidden="true" />
  );
}

function details(record: DocumentRecord): string {
  const pages =
    record.pageCount > 0
      ? `${record.pageCount} ${record.pageCount === 1 ? 'page' : 'pages'}, `
      : '';
  return `${pages}changed ${DATE.format(record.updatedAt)}`;
}

function RecentItem({ record }: { record: DocumentRecord }) {
  return (
    <li className={styles.item}>
      <button type="button" className={styles.open} onClick={() => void openSaved(record.id)}>
        <Thumbnail png={record.thumbnail} />
        <span className={styles.text}>
          <span className={styles.name}>{record.name}</span>
          <span className={styles.details}>{details(record)}</span>
        </span>
      </button>
      <Button
        variant="quiet"
        aria-label={`Delete ${record.name}`}
        onClick={() => void deleteSaved(record.id)}
      >
        Delete
      </Button>
    </li>
  );
}

export function RecentDocuments() {
  const recent = useSessionStore((state) => state.recent);
  if (recent.length === 0) {
    return <p className={styles.empty}>Documents you open will be listed here.</p>;
  }
  return (
    <ul className={styles.list}>
      {recent.map((record) => (
        <RecentItem key={record.id} record={record} />
      ))}
    </ul>
  );
}
