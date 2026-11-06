// Document-level drop guard (spec §11.2): a drop outside a drop zone must never navigate the tab to
// the dropped file or link, and link or HTML drags are never accepted anywhere.

/**
 * Cancels the browser's default handling of every drag that a drop zone has not claimed. Drop zones
 * claim only file drags (by calling preventDefault in their own handlers), so `text/uri-list` and
 * `text/html` drags are refused everywhere.
 */
export function installDropGuard(target: Pick<Window, 'addEventListener' | 'removeEventListener'>) {
  const onDragOver = (event: DragEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
  };
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
