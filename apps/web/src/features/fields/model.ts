// Pure logic behind the field layer and the Fields panel (F1–F8, spec §5.4, §6.3, §7.1). The
// components stay thin: everything that can be decided without the DOM is decided here.
import type {
  FieldDescriptor,
  FieldValue,
  FieldValues,
  PageGeometry,
  PdfInfo,
  WidgetGeometry,
} from '@bogey/core';
import { scaleFor, widgetScreenRect } from '../../core-bridge/geometry.ts';
import { autoFieldFontSize } from '../../core-bridge/text.ts';

/** What the document shows for a field: the user's override, else the PDF's own value (§6.3). */
export function currentValue(
  name: string,
  overrides: FieldValues,
  initial: FieldValues,
): FieldValue | undefined {
  if (Object.hasOwn(overrides, name)) return overrides[name];
  if (Object.hasOwn(initial, name)) return initial[name];
  return undefined;
}

export const asText = (value: FieldValue | undefined): string =>
  typeof value === 'string' ? value : '';

export const asChecked = (value: FieldValue | undefined): boolean => value === true;

export const asList = (value: FieldValue | undefined): readonly string[] =>
  Array.isArray(value) ? value : typeof value === 'string' && value !== '' ? [value] : [];

/** The last component of a fully qualified name: `a.b[0].c[0]` → `c[0]`. */
export function partialName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(dot + 1);
}

/** U4: the `/TU` alternate name when present, else the partial name. */
export function fieldLabel(field: Pick<FieldDescriptor, 'name' | 'alternateName'>): string {
  const alternate = field.alternateName?.trim();
  return alternate ? alternate : partialName(field.name);
}

/** Button and signature fields are outlines only (F1). */
export const isFillable = (field: FieldDescriptor): boolean =>
  field.supported && field.kind !== 'button' && field.kind !== 'signature';

/** A text field snippets can fill (N2): fillable, editable text. */
export const isTextTarget = (field: FieldDescriptor): boolean =>
  isFillable(field) && field.kind === 'text' && !field.readOnly;

export interface PlacedWidget {
  field: FieldDescriptor;
  /** Index of the field in `PdfInfo.fields`; ids are built from it, never from the name. */
  fieldIndex: number;
  widget: WidgetGeometry;
  widgetIndex: number;
}

/**
 * The widgets on one page in tab order (F6): by the field's tab order, then widget order. DOM
 * order follows this list, so Tab walks the page in document order.
 */
export function widgetsOnPage(fields: readonly FieldDescriptor[], page: number): PlacedWidget[] {
  const placed: PlacedWidget[] = [];
  fields.forEach((field, fieldIndex) => {
    field.widgets.forEach((widget, widgetIndex) => {
      if (widget.page === page) placed.push({ field, fieldIndex, widget, widgetIndex });
    });
  });
  return placed.sort(
    (a, b) =>
      a.field.tabOrder - b.field.tabOrder ||
      a.fieldIndex - b.fieldIndex ||
      a.widgetIndex - b.widgetIndex,
  );
}

/** A DOM id for one widget's control, safe whatever the field is called. */
export const controlId = (fieldIndex: number, widgetIndex: number): string =>
  `field-${fieldIndex}-${widgetIndex}`;

/** The nearest page after (`step` 1) or before (`step` -1) `page` that has a fillable widget. */
export function pageWithFields(
  fields: readonly FieldDescriptor[],
  page: number,
  step: 1 | -1,
): number | null {
  const pages = new Set<number>();
  for (const field of fields) {
    if (!isFillable(field)) continue;
    for (const widget of field.widgets) pages.add(widget.page);
  }
  const candidates = [...pages].filter((p) => (step === 1 ? p > page : p < page));
  if (candidates.length === 0) return null;
  return step === 1 ? Math.min(...candidates) : Math.max(...candidates);
}

export interface ControlBox {
  /** CSS px from the page's top-left, of the unrotated control. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Clockwise CSS rotation about the control's center (spec §5.4). */
  rotation: 0 | 90 | 180 | 270;
  /** The control's own size in points, which is the widget's `/MK /R` frame. */
  widthPt: number;
  heightPt: number;
  /** CSS px per point at this zoom. */
  k: number;
}

/**
 * Where a widget's control goes. The screen rectangle is the rotated widget's bounding box; for a
 * quarter turn the control itself is that box turned on its side, centered in the same place.
 */
export function controlBox(page: PageGeometry, widget: WidgetGeometry, zoom: number): ControlBox {
  const rect = widgetScreenRect(page, widget, zoom);
  const k = scaleFor(page, zoom);
  const sideways = rect.rotation === 90 || rect.rotation === 270;
  const width = sideways ? rect.height : rect.width;
  const height = sideways ? rect.width : rect.height;
  return {
    left: rect.x + (rect.width - width) / 2,
    top: rect.y + (rect.height - height) / 2,
    width,
    height,
    rotation: rect.rotation,
    widthPt: width / k,
    heightPt: height / k,
    k,
  };
}

/**
 * The on-screen font size in CSS px: `/DA` size × k, or for auto (0) the size pdf-lib's
 * appearance generator would choose for this value, so the screen matches the export (§7.1).
 */
export function fontSizePx(field: FieldDescriptor, value: string, box: ControlBox): number {
  if (field.fontSize > 0) return field.fontSize * box.k;
  const pt = autoFieldFontSize(
    value,
    { width: box.widthPt, height: box.heightPt },
    {
      ...(field.multiline !== undefined ? { multiline: field.multiline } : {}),
      ...(field.comb !== undefined ? { comb: field.comb } : {}),
      ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
      textAlign: field.textAlign,
    },
  );
  return pt * box.k;
}

/** A comb field's cell width in CSS px (F4): the control width over the character count. */
export function combCell(field: FieldDescriptor, widthPx: number): number | null {
  if (field.comb !== true || field.maxLength === undefined || field.maxLength <= 0) return null;
  return widthPx / field.maxLength;
}

/** Options for a `<select>`: the field's own, plus a blank and any value not among them. */
export function selectOptions(
  field: FieldDescriptor,
  selected: readonly string[],
  blank: boolean,
): { value: string; label: string }[] {
  const options = (field.options ?? []).map((o) => ({ value: o.value, label: o.label }));
  const known = new Set(options.map((o) => o.value));
  const extra = selected.filter((v) => v !== '' && !known.has(v));
  return [
    ...(blank ? [{ value: '', label: '' }] : []),
    ...options,
    ...extra.map((v) => ({ value: v, label: v })),
  ];
}

/** The on-value a radio or checkbox widget stands for (F5). */
export function widgetOnValue(field: FieldDescriptor, placed: PlacedWidget): string {
  return placed.widget.onValue ?? field.onValues?.[placed.widgetIndex] ?? field.onValues?.[0] ?? '';
}

const KIND_LABEL: Record<FieldDescriptor['kind'], string> = {
  text: 'Text',
  checkbox: 'Checkbox',
  radio: 'Radio buttons',
  dropdown: 'Dropdown',
  list: 'List',
  button: 'Button',
  signature: 'Signature',
};

export function kindLabel(field: FieldDescriptor): string {
  if (field.kind === 'text' && field.multiline) return 'Text, several lines';
  if (field.kind === 'dropdown' && field.editable) return 'Dropdown, editable';
  return KIND_LABEL[field.kind];
}

/** A field's value as the Fields panel shows it (F7). */
export function describeValue(field: FieldDescriptor, value: FieldValue | undefined): string {
  switch (field.kind) {
    case 'button':
    case 'signature':
      return 'Not fillable';
    case 'checkbox':
      return asChecked(value) ? 'Checked' : 'Not checked';
    case 'list': {
      const items = asList(value);
      return items.length === 0
        ? 'None selected'
        : items.map((v) => optionLabel(field, v)).join(', ');
    }
    case 'radio':
    case 'dropdown': {
      const text = asText(value);
      return text === '' ? 'None selected' : optionLabel(field, text);
    }
    default: {
      const text = asText(value);
      if (text === '') return 'Empty';
      return field.password ? '•'.repeat([...text].length) : text;
    }
  }
}

function optionLabel(field: FieldDescriptor, value: string): string {
  return field.options?.find((o) => o.value === value)?.label || value;
}

export interface PanelRow {
  field: FieldDescriptor;
  fieldIndex: number;
  label: string;
  kind: string;
  value: string;
}

/** F7: every field in tab order, filtered by label or full name, case-insensitive. */
export function panelRows(
  fields: readonly FieldDescriptor[],
  overrides: FieldValues,
  initial: FieldValues,
  filter: string,
): PanelRow[] {
  const needle = filter.trim().toLocaleLowerCase();
  return fields
    .map((field, fieldIndex) => ({ field, fieldIndex }))
    .sort((a, b) => a.field.tabOrder - b.field.tabOrder || a.fieldIndex - b.fieldIndex)
    .map(({ field, fieldIndex }) => ({
      field,
      fieldIndex,
      label: fieldLabel(field),
      kind: kindLabel(field),
      value: describeValue(field, currentValue(field.name, overrides, initial)),
    }))
    .filter(
      (row) =>
        needle === '' ||
        row.label.toLocaleLowerCase().includes(needle) ||
        row.field.name.toLocaleLowerCase().includes(needle),
    );
}

export type NoticeKind = 'xfa-hybrid' | 'xfa-dynamic' | 'many-pages';

/** D4 and spec §6.1: the notices a document opens with. */
export function noticesFor(
  info: Pick<PdfInfo, 'xfa' | 'pageCount'>,
  slowPageCount: number,
): NoticeKind[] {
  const notices: NoticeKind[] = [];
  if (info.xfa === 'hybrid') notices.push('xfa-hybrid');
  if (info.xfa === 'dynamic') notices.push('xfa-dynamic');
  if (info.pageCount > slowPageCount) notices.push('many-pages');
  return notices;
}
