// The field layer (F2, F6, spec §5.4, §7.1): one native control per widget on the current page,
// over the page canvas. The canvas leaves form widgets out (spec §10.3), so this layer draws every
// value, read-only ones included (F8). Tab past the last control on a page turns to the next page
// with fields and focuses its first control; Shift+Tab before the first goes back.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { EMPTY_EDIT_STATE } from '../../core-bridge/model.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useViewStore } from '../../state/view.ts';
import { FieldControl } from './FieldControl.tsx';
import { applyFocus, requestFocus, takeFocusRequest } from './focus.ts';
import { controlBox, currentValue, pageWithFields, widgetsOnPage } from './model.ts';
import { leavesPage } from './tabbing.ts';
import styles from './FieldLayer.module.css';

const NO_FIELDS: never[] = [];

export function FieldLayer() {
  const info = useDocumentStore((state) => state.info);
  const page = useViewStore((state) => state.page);
  const zoom = useViewStore((state) => state.renderedZoom);
  const setPage = useViewStore((state) => state.setPage);
  const overrides = useEditsStore((state) => state.present.fieldValues);
  const layer = useRef<HTMLDivElement>(null);

  const fields = info?.fields ?? NO_FIELDS;
  // Optional chaining on `pages` too: a document without page geometry draws no fields.
  const geometry = info?.pages?.[page];
  const placed = useMemo(() => widgetsOnPage(fields, page), [fields, page]);
  const ready = geometry !== undefined && zoom !== null && placed.length > 0;

  // A snippet target left over from another document is dropped (N2).
  useEffect(() => {
    const target = useViewStore.getState().targetField;
    if (target !== null && !fields.some((f) => f.name === target)) {
      useViewStore.getState().setTargetField(null);
    }
  }, [fields]);

  // A focus request from the Fields panel or from tabbing off the previous page.
  useLayoutEffect(() => {
    if (!ready || !layer.current) return;
    const request = takeFocusRequest(page);
    if (request) applyFocus(layer.current, request);
  }, [ready, page]);

  // Snippets fill the last focused text field until the user clicks elsewhere on the page (N2).
  useEffect(() => {
    const sheet = layer.current?.parentElement;
    if (!sheet) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const control = target?.closest?.('[data-field-control]');
      if (!control) useViewStore.getState().setTargetField(null);
    };
    sheet.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => sheet.removeEventListener('pointerdown', onPointerDown);
  }, [ready]);

  // Tab off the last control turns the page (F6). Listened for natively on the layer, which is a
  // group of controls rather than a control itself.
  useEffect(() => {
    const root = layer.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.shiftKey ? -1 : 1;
      if (!leavesPage(root, event.target as HTMLElement, step)) return;
      const next = pageWithFields(fields, page, step);
      if (next === null) return;
      event.preventDefault();
      requestFocus(next, step === 1 ? 'first' : 'last');
      setPage(next);
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [ready, fields, page, setPage]);

  if (!ready) return null;

  const initial = info?.initialValues ?? EMPTY_EDIT_STATE.fieldValues;
  return (
    <div
      ref={layer}
      role="group"
      aria-label={`Form fields on page ${page + 1}`}
      className={styles.layer}
      data-field-layer=""
    >
      {placed.map((p) => (
        <FieldControl
          key={`${p.fieldIndex}-${p.widgetIndex}`}
          placed={p}
          box={controlBox(geometry, p.widget, zoom)}
          value={currentValue(p.field.name, overrides, initial)}
        />
      ))}
    </div>
  );
}
