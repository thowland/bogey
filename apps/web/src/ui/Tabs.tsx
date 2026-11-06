// Tabs with the ARIA tabs pattern: arrow keys move between tabs, Home and End jump (spec §13).
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  content: ReactNode;
}

export interface TabsProps<K extends string> {
  label: string;
  items: readonly TabItem<K>[];
  selected: K;
  onSelect(key: K): void;
}

export function Tabs<K extends string>({ label, items, selected, onSelect }: TabsProps<K>) {
  const base = useId();
  const refs = useRef(new Map<K, HTMLButtonElement>());

  const move = (event: KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const key = items[next]!.key;
    onSelect(key);
    refs.current.get(key)?.focus();
  };

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label={label} className={styles.list}>
        {items.map((item, index) => (
          <button
            key={item.key}
            ref={(node) => {
              if (node) refs.current.set(item.key, node);
              else refs.current.delete(item.key);
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${item.key}`}
            aria-controls={`${base}-panel-${item.key}`}
            aria-selected={item.key === selected}
            tabIndex={item.key === selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onSelect(item.key)}
            onKeyDown={(event) => move(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.key}
          role="tabpanel"
          id={`${base}-panel-${item.key}`}
          aria-labelledby={`${base}-tab-${item.key}`}
          hidden={item.key !== selected}
          className={styles.panel}
        >
          {item.key === selected && item.content}
        </div>
      ))}
    </div>
  );
}
