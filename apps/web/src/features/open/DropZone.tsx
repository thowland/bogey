// The drop zone (D1, spec §11.2): accepts a dropped file and nothing else. Link and HTML drags are
// left to the document-level guard, which refuses them.
import { useState, type DragEvent } from 'react';
import { useDocumentStore } from '../../state/document.ts';
import { messageFor } from '../../ui/messages.ts';
import { FilePicker } from './FilePicker.tsx';
import { openDocument } from './openDocument.ts';
import styles from './EmptyState.module.css';

const carriesFiles = (event: DragEvent) => [...event.dataTransfer.types].includes('Files');

export function DropZone() {
  const status = useDocumentStore((state) => state.status);
  const problem = useDocumentStore((state) => state.problem);
  const name = useDocumentStore((state) => state.name);
  const [over, setOver] = useState(false);

  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const onDrop = (event: DragEvent) => {
    setOver(false);
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void openDocument(file);
  };

  return (
    <section
      aria-label="Open a PDF"
      className={over ? `${styles.drop} ${styles.over}` : styles.drop}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <p className={styles.dropTitle}>Drop a PDF here to fill and sign it</p>
      <FilePicker variant="primary">Choose a PDF</FilePicker>
      {status === 'opening' && (
        <p className={styles.dropHint} role="status">
          Opening {name}…
        </p>
      )}
      {status === 'error' && problem && (
        <p className={styles.dropError} role="alert">
          {messageFor(problem)}
        </p>
      )}
    </section>
  );
}
