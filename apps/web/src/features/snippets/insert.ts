// What a snippet button does (N2, N4, spec §7.2, §10.4). With a target text field, the snippet
// becomes that field's value; otherwise it becomes a text overlay at the last point clicked on the
// page shown, or 36 pt in from the page's top-left corner. Either way the change goes through
// state/edits.ts, so it can be undone.
import type { DateOverlay, FieldDescriptor, PageGeometry, Point, TextOverlay } from '@bogey/core';
import { screenToPdf, snapToGrid, uprightOffset } from '../../core-bridge/geometry.ts';
import { TEXT } from '../../core-bridge/model.ts';
import { formatDate } from '../../core-bridge/text.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useSettingsStore } from '../../state/settings.ts';
import { useViewStore } from '../../state/view.ts';
import { fieldLabel, isTextTarget } from '../fields/model.ts';

/** spec §7.2: where a snippet goes on a page nobody has clicked. */
export const DEFAULT_INSET_PT = 36;

export type InsertResult =
  { kind: 'field'; label: string } | { kind: 'overlay'; page: number } | { kind: 'none' };

/** Today in the configured format (N4, O5). `now` is for tests. */
export function todayText(now: Date = new Date()): string {
  return formatDate(
    { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() },
    useSettingsStore.getState().dateFormat,
  );
}

/** The text field snippets fill now, if any (N2). */
export function targetField(): FieldDescriptor | null {
  const name = useViewStore.getState().targetField;
  const fields = useDocumentStore.getState().info?.fields;
  if (name === null || !fields) return null;
  const field = fields.find((f) => f.name === name);
  return field && isTextTarget(field) ? field : null;
}

/** The label the "Fills:" line shows. */
export const targetLabel = (field: FieldDescriptor): string => fieldLabel(field);

/** A value fitted to a field: one line unless multiline, and no longer than its maximum (F3). */
export function fitToField(field: FieldDescriptor, value: string): string {
  const text = field.multiline ? value : value.replace(/\r\n|\r|\n/g, ' ');
  if (field.maxLength === undefined) return text;
  const chars = [...text];
  return chars.length > field.maxLength ? chars.slice(0, field.maxLength).join('') : text;
}

/**
 * Where a snippet lands on `page`: the last point clicked there in select mode, or 36 pt in from
 * the top-left of the page as shown (the baseline one text size further down, so the text's top
 * sits about 36 pt in).
 */
export function snippetAnchor(
  geometry: PageGeometry,
  page: number,
  size: number,
  lastPoint: { page: number; point: Point } | null,
): Point {
  if (lastPoint && lastPoint.page === page) return snapToGrid(lastPoint.point);
  const corner = screenToPdf(geometry, { x: 0, y: 0 }, 1);
  return snapToGrid(
    uprightOffset(geometry.rotate, corner, DEFAULT_INSET_PT, -(DEFAULT_INSET_PT + size)),
  );
}

/**
 * Inserts `value` (N2). Empty values and a missing document do nothing. After an overlay is
 * placed, the last point moves down one line, so the next snippet lands underneath it.
 */
export function insertSnippet(value: string, { date = false } = {}): InsertResult {
  const doc = useDocumentStore.getState();
  if (value === '' || doc.status !== 'ready' || !doc.info) return { kind: 'none' };
  const edits = useEditsStore.getState();

  const field = targetField();
  if (field) {
    edits.edit({ type: 'setField', name: field.name, value: fitToField(field, value) });
    return { kind: 'field', label: targetLabel(field) };
  }

  const view = useViewStore.getState();
  const geometry = doc.info.pages[view.page];
  if (!geometry) return { kind: 'none' };
  const size = Math.min(
    TEXT.maxSize,
    Math.max(TEXT.minSize, useSettingsStore.getState().defaultFontSize),
  );
  const at = snippetAnchor(geometry, view.page, size, view.lastPoint);
  const overlay: TextOverlay | DateOverlay = {
    id: crypto.randomUUID(),
    type: date ? 'date' : 'text',
    page: view.page,
    x: at.x,
    y: at.y,
    text: value,
    size,
    bold: false,
  };
  const before = edits.present;
  edits.edit({ type: 'addOverlay', overlay });
  if (useEditsStore.getState().present === before) return { kind: 'none' };
  const lines = value.split(/\r\n|\r|\n/).length;
  view.setLastPoint({
    page: view.page,
    point: uprightOffset(geometry.rotate, at, 0, -lines * TEXT.lineHeightFactor * size),
  });
  return { kind: 'overlay', page: view.page };
}
