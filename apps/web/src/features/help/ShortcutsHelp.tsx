// The keyboard shortcuts dialog (U2, spec §10.4): a toolbar button and the `?` key open it.
import { useEffect, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { SHORTCUTS, isApple, isHelpKey, keyName } from './shortcuts.ts';
import styles from './Help.module.css';

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isHelpKey(event)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <Button
        variant="quiet"
        aria-keyshortcuts="?"
        title="Keyboard shortcuts (?)"
        onClick={() => setOpen(true)}
      >
        Shortcuts
      </Button>
      <Dialog
        open={open}
        title="Keyboard shortcuts"
        onClose={() => setOpen(false)}
        actions={<Button onClick={() => setOpen(false)}>Close</Button>}
      >
        <ShortcutList apple={isApple()} />
      </Dialog>
    </>
  );
}

export function ShortcutList({ apple }: { apple: boolean }) {
  return (
    <div className={styles.groups}>
      <p className={styles.note}>
        Single-letter keys do nothing while you are typing in a field or a text box.
      </p>
      {SHORTCUTS.map((group) => (
        <section key={group.title}>
          <h3 className={styles.title}>{group.title}</h3>
          <dl className={styles.list}>
            {group.items.map((item) => (
              <div key={item.action} className={styles.row}>
                <dt className={styles.keys}>
                  {item.keys.map((combo, i) => (
                    <span key={i}>
                      {i > 0 && <span className={styles.or}> or </span>}
                      {combo.map((key, j) => (
                        <span key={j}>
                          {j > 0 && '+'}
                          <kbd className={styles.kbd}>{keyName(key, apple)}</kbd>
                        </span>
                      ))}
                    </span>
                  ))}
                </dt>
                <dd className={styles.action}>{item.action}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
