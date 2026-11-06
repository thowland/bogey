// The Fields panel (F7, spec §7.1): every field in tab order with its kind and current value,
// filterable by name. Choosing a row turns to the widget's page and focuses its control.
import { useId, useState } from 'react';
import { EMPTY_EDIT_STATE } from '../../core-bridge/model.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useViewStore } from '../../state/view.ts';
import placeholder from '../placeholder.module.css';
import { goToWidget } from './focus.ts';
import { controlId, panelRows, type PanelRow } from './model.ts';
import styles from './FieldsPanel.module.css';

export const NO_FIELDS_TEXT = 'Form fields are listed here when the PDF has them.';

export function FieldsPanel() {
  const info = useDocumentStore((state) => (state.status === 'ready' ? state.info : null));
  const overrides = useEditsStore((state) => state.present.fieldValues);
  const page = useViewStore((state) => state.page);
  const setPage = useViewStore((state) => state.setPage);
  const [filter, setFilter] = useState('');
  const countId = useId();

  if (!info || info.fields.length === 0) {
    return <p className={placeholder.empty}>{NO_FIELDS_TEXT}</p>;
  }
  const rows = panelRows(
    info.fields,
    overrides,
    info.initialValues ?? EMPTY_EDIT_STATE.fieldValues,
    filter,
  );
  const open = (row: PanelRow) => {
    const widget = row.field.widgets[0];
    if (widget) goToWidget(widget.page, controlId(row.fieldIndex, 0), page, setPage);
  };

  return (
    <div className={styles.panel}>
      <input
        type="search"
        className={styles.filter}
        placeholder="Filter by name"
        aria-label="Filter fields by name"
        aria-describedby={countId}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <p id={countId} className={styles.count} aria-live="polite">
        {rows.length === info.fields.length
          ? `${info.fields.length} ${info.fields.length === 1 ? 'field' : 'fields'}`
          : `${rows.length} of ${info.fields.length} fields`}
      </p>
      {rows.length === 0 ? (
        <p className={styles.empty}>No field names match that filter.</p>
      ) : (
        <ul className={styles.list} aria-label="Fields">
          {rows.map((row) => (
            <li key={row.fieldIndex}>
              <button
                type="button"
                className={styles.row}
                title={row.field.name}
                aria-label={`${row.label}, ${row.kind}, page ${(row.field.widgets[0]?.page ?? 0) + 1}: ${row.value}`}
                onClick={() => open(row)}
              >
                {/* The page is shown too, and the parts are spaced, so the visible text reads as
                    the name does (WCAG 2.5.3). Spaces between grid items take no room. */}
                <span className={styles.label}>{row.label}</span>{' '}
                <span className={styles.kind}>
                  {row.kind}, page {(row.field.widgets[0]?.page ?? 0) + 1}
                </span>{' '}
                <span className={styles.value}>{row.value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
