// A modal dialog on the native <dialog> element: focus is trapped and restored by the browser,
// and Escape closes it (spec §13).
import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Buttons along the bottom edge. */
  actions?: ReactNode;
  role?: 'dialog' | 'alertdialog';
}

export function Dialog({ open, title, onClose, children, actions, role = 'dialog' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={titleId}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <div className={styles.body}>{children}</div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </>
      )}
    </dialog>
  );
}
