// The zoom level menu: a menu button with one radio item per choice (WAI-ARIA menu button
// pattern). A native <select> would be simpler, but WebKit reports a style-src-attr CSP violation
// for every <select> it creates (docs/spikes/S1-pdfjs.md), and the E2E suite fails on any report.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Zoom } from '../../state/persistence.ts';
import { Button } from '../../ui/Button.tsx';
import { zoomLabel, zoomValue } from './zoom.ts';
import styles from './Controls.module.css';

export interface ZoomMenuProps {
  zoom: Zoom;
  choices: readonly Zoom[];
  onChoose(zoom: Zoom): void;
}

export function ZoomMenu({ zoom, choices, onChoose }: ZoomMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) wrapper.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
  };

  useEffect(() => {
    if (!open) return;
    (items().find((item) => item.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (next: number) => list[(next + list.length) % list.length]?.focus();
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(list.length - 1);
    else if (event.key === 'Escape') close(true);
    else if (event.key === 'Tab') return close(false);
    else return;
    event.preventDefault();
  };

  return (
    <div ref={wrapper} className={styles.menuWrapper}>
      <Button
        variant="quiet"
        className={styles.menuButton}
        aria-label={`Zoom level: ${zoomLabel(zoom)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        {zoomLabel(zoom)}
      </Button>
      {open && (
        // The menu's items are buttons; arrow keys move between them (menu button pattern).
        <ul
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Zoom level"
          className={styles.menu}
          onKeyDown={onKeyDown}
        >
          {choices.map((choice) => (
            <li key={zoomValue(choice)} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={zoomValue(choice) === zoomValue(zoom)}
                tabIndex={-1}
                className={styles.menuItem}
                onClick={() => {
                  onChoose(choice);
                  close(true);
                }}
              >
                {zoomLabel(choice)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
