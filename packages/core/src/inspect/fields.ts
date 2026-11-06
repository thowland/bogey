// Field enumeration (spec §6.3, F1): one descriptor per terminal field with at least one widget on
// a page, its flags and initial value, widgets assigned to pages, and tab order (F6).
import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFTextField,
  type PDFDocument,
  type PDFField,
  type PDFWidgetAnnotation,
} from '@cantoo/pdf-lib';
import { normalizeBox, normalizeRotation } from '../geometry/index.ts';
import type { FieldDescriptor, FieldKind, FieldOption, FieldValue } from '../model/fields.ts';
import type { WidgetGeometry } from '../model/geometry.ts';
import { get, getArray, getDict, getNumber, getText, inherited, numbersOf } from './pdfObjects.ts';

interface PlacedWidget {
  geometry: WidgetGeometry;
  /** Position in the page's /Annots, or Infinity when only /P places it. */
  annotIndex: number;
}

interface WidgetLocation {
  page: number;
  annotIndex: number;
}

/** Where each annotation dictionary sits: its page and its index in that page's /Annots. */
function annotationIndex(doc: PDFDocument) {
  const byDict = new Map<PDFDict, WidgetLocation>();
  const pageByRef = new Map<string, number>();
  const tabs: string[] = [];
  doc.getPages().forEach((page, pageIndex) => {
    pageByRef.set(page.ref.toString(), pageIndex);
    tabs.push(getText(page.node, 'Tabs') ?? '');
    const annots = getArray(page.node, 'Annots');
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (annot instanceof PDFDict && !byDict.has(annot)) {
        byDict.set(annot, { page: pageIndex, annotIndex: i });
      }
    }
  });
  return { byDict, pageByRef, tabs };
}

function locate(
  widget: PDFWidgetAnnotation,
  index: ReturnType<typeof annotationIndex>,
): WidgetLocation | undefined {
  const inAnnots = index.byDict.get(widget.dict);
  const p = widget.dict.get(PDFName.of('P'));
  if (p instanceof PDFRef) {
    const page = index.pageByRef.get(p.toString());
    if (page !== undefined) {
      return {
        page,
        annotIndex: inAnnots?.page === page ? inAnnots.annotIndex : Number.POSITIVE_INFINITY,
      };
    }
  }
  return inAnnots;
}

/** `/DA` font size: widget, then field (inherited), then the AcroForm default. 0 means auto. */
function fontSizeOf(field: PDFField, widget: PDFWidgetAnnotation | undefined, acroForm?: PDFDict) {
  const da =
    (widget && getText(widget.dict, 'DA')) ??
    (() => {
      const v = inherited(field.acroField.dict, 'DA');
      return v && 'decodeText' in v ? (v as { decodeText(): string }).decodeText() : undefined;
    })() ??
    (acroForm && getText(acroForm, 'DA'));
  const match = da ? /(-?\d*\.?\d+)\s+Tf/.exec(da) : null;
  const size = match ? Number(match[1]) : 0;
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function alignOf(field: PDFField, acroForm?: PDFDict): FieldDescriptor['textAlign'] {
  const q = inherited(field.acroField.dict, 'Q');
  const value =
    q && 'asNumber' in q
      ? (q as { asNumber(): number }).asNumber()
      : acroForm
        ? getNumber(acroForm, 'Q')
        : undefined;
  return value === 1 ? 'center' : value === 2 ? 'right' : 'left';
}

const onValueName = (widget: PDFWidgetAnnotation) => widget.getOnValue()?.decodeText();

function choiceOptions(field: PDFDropdown | PDFOptionList): FieldOption[] {
  const seen = new Set<string>();
  const options: FieldOption[] = [];
  for (const { value, display } of field.acroField.getOptions()) {
    const v = value.decodeText();
    if (seen.has(v)) continue;
    seen.add(v);
    options.push({ value: v, label: (display ?? value).decodeText() });
  }
  return options;
}

/** A stored choice (export value or display text) mapped onto the option values. */
function choiceValue(raw: string, options: readonly FieldOption[]): string | undefined {
  return options.find((o) => o.value === raw)?.value ?? options.find((o) => o.label === raw)?.value;
}

export interface EnumeratedFields {
  fields: FieldDescriptor[];
  initialValues: Record<string, FieldValue>;
}

interface Draft {
  descriptor: Omit<FieldDescriptor, 'tabOrder' | 'widgets'>;
  widgets: PlacedWidget[];
  initial: FieldValue | undefined;
}

function describe(field: PDFField, placed: PlacedWidget[], acroForm?: PDFDict): Draft | undefined {
  const widgets = field.acroField.getWidgets();
  const common = {
    name: field.getName(),
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
    fontSize: fontSizeOf(field, widgets[0], acroForm),
    textAlign: alignOf(field, acroForm),
    ...(() => {
      const tu = getText(field.acroField.dict, 'TU');
      return tu ? { alternateName: tu } : {};
    })(),
  };
  const draft = (
    kind: FieldKind,
    extra: Partial<FieldDescriptor>,
    initial: FieldValue | undefined,
  ): Draft => ({
    descriptor: { ...common, kind, supported: kind !== 'button' && kind !== 'signature', ...extra },
    widgets: placed,
    initial,
  });

  if (field instanceof PDFTextField) {
    const maxLength = field.getMaxLength();
    return draft(
      'text',
      {
        multiline: field.isMultiline(),
        comb: field.isCombed(),
        password: field.isPassword(),
        ...(maxLength !== undefined ? { maxLength } : {}),
      },
      field.getText() ?? '',
    );
  }
  if (field instanceof PDFCheckBox) {
    const onValues = [...new Set(placed.map((w) => w.geometry.onValue ?? 'Yes'))];
    if (onValues.length > 1) {
      // Several widgets with distinct on-states behave as a radio group (spec §6.3).
      const v = field.acroField.V();
      const selected = v instanceof PDFName ? v.decodeText() : '';
      return draft('radio', { onValues }, onValues.includes(selected) ? selected : '');
    }
    return draft('checkbox', { onValues }, field.isChecked());
  }
  if (field instanceof PDFRadioGroup) {
    const onValues = [...new Set(placed.map((w) => w.geometry.onValue!))];
    const selected = field.getSelected() ?? '';
    return draft('radio', { onValues }, onValues.includes(selected) ? selected : '');
  }
  if (field instanceof PDFDropdown) {
    const options = choiceOptions(field);
    const raw = field.getSelected()[0] ?? '';
    const editable = field.isEditable();
    return draft(
      'dropdown',
      { options, editable },
      choiceValue(raw, options) ?? (editable ? raw : ''),
    );
  }
  if (field instanceof PDFOptionList) {
    const options = choiceOptions(field);
    const selected = [
      ...new Set(
        field.getSelected().flatMap((raw) => {
          const v = choiceValue(raw, options);
          return v === undefined ? [] : [v];
        }),
      ),
    ];
    const multiSelect = field.isMultiselect();
    return draft('list', { options, multiSelect }, multiSelect ? selected : selected.slice(0, 1));
  }
  if (field instanceof PDFButton) return draft('button', {}, undefined);
  if (field instanceof PDFSignature) return draft('signature', {}, undefined);
  return undefined;
}

/** Widgets of one field with their page, rect and on-state; widgets on no page are dropped. */
function placeWidgets(field: PDFField, index: ReturnType<typeof annotationIndex>): PlacedWidget[] {
  const widgets = field.acroField.getWidgets();
  const radioOptions = field instanceof PDFRadioGroup ? field.getOptions() : undefined;
  const placed: PlacedWidget[] = [];
  widgets.forEach((widget, i) => {
    const location = locate(widget, index);
    const rect = numbersOf(get(widget.dict, 'Rect'));
    if (!location || !rect) return;
    const mk = getDict(widget.dict, 'MK');
    const onName = onValueName(widget);
    // Radio options with /Opt are export values, matched to widgets by position (as pdf-lib does).
    const onValue =
      field instanceof PDFRadioGroup
        ? (radioOptions?.[i] ?? onName)
        : field instanceof PDFCheckBox
          ? onName
          : undefined;
    placed.push({
      geometry: {
        page: location.page,
        rect: normalizeBox(rect),
        mkRotation: normalizeRotation(mk ? getNumber(mk, 'R') : 0),
        ...(onValue !== undefined ? { onValue } : {}),
      },
      annotIndex: location.annotIndex,
    });
  });
  return placed;
}

/** Tab-order rank of a widget: page, the page's /Tabs order, then position in /Annots (F6). */
function rankWidgets<T extends { widget: PlacedWidget }>(
  entries: T[],
  tabs: readonly string[],
): T[] {
  return [...entries].sort((a, b) => {
    const wa = a.widget;
    const wb = b.widget;
    if (wa.geometry.page !== wb.geometry.page) return wa.geometry.page - wb.geometry.page;
    const order = tabs[wa.geometry.page];
    const [ax0, , , ay1] = wa.geometry.rect;
    const [bx0, , , by1] = wb.geometry.rect;
    if (order === 'R' || order === 'S') {
      if (ay1 !== by1) return by1 - ay1;
      if (ax0 !== bx0) return ax0 - bx0;
    } else if (order === 'C') {
      if (ax0 !== bx0) return ax0 - bx0;
      if (ay1 !== by1) return by1 - ay1;
    }
    return wa.annotIndex - wb.annotIndex;
  });
}

export function enumerateFields(doc: PDFDocument): EnumeratedFields {
  const index = annotationIndex(doc);
  const form = doc.getForm();
  const acroForm = form.acroForm.dict;
  const drafts: Draft[] = [];
  for (const field of form.getFields()) {
    try {
      const placed = placeWidgets(field, index);
      if (placed.length === 0) continue;
      const d = describe(field, placed, acroForm);
      if (!d) continue;
      drafts.push(d);
    } catch {
      // A malformed field is left out rather than failing the whole document.
    }
  }

  const ranked = rankWidgets(
    drafts.flatMap((draft, fieldIndex) => draft.widgets.map((widget) => ({ widget, fieldIndex }))),
    index.tabs,
  );
  const firstRank = new Map<number, number>();
  const widgetOrder = new Map<PlacedWidget, number>();
  ranked.forEach(({ widget, fieldIndex }, rank) => {
    widgetOrder.set(widget, rank);
    if (!firstRank.has(fieldIndex)) firstRank.set(fieldIndex, rank);
  });
  const order = drafts.map((_, i) => i).sort((a, b) => firstRank.get(a)! - firstRank.get(b)!);

  const fields: FieldDescriptor[] = [];
  const initialEntries: [string, FieldValue][] = [];
  const seen = new Set<string>();
  order.forEach((fieldIndex) => {
    const draft = drafts[fieldIndex]!;
    if (seen.has(draft.descriptor.name)) return;
    seen.add(draft.descriptor.name);
    const widgets = [...draft.widgets]
      .sort((a, b) => widgetOrder.get(a)! - widgetOrder.get(b)!)
      .map((w) => w.geometry);
    fields.push({ ...draft.descriptor, widgets, tabOrder: fields.length } as FieldDescriptor);
    if (draft.initial !== undefined) initialEntries.push([draft.descriptor.name, draft.initial]);
  });
  // Object.fromEntries defines own properties, so a field named '__proto__' stays data.
  return { fields, initialValues: Object.fromEntries(initialEntries) };
}
