// Filling and flattening (spec §9.1 step 2, E2): set overridden fields with the typed setters,
// regenerate appearances where they are missing, flatten, and drop the form.
import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFStream,
  PDFTextField,
  type PDFDocument,
  type PDFField,
  type PDFFont,
  type PDFForm,
} from '@cantoo/pdf-lib';
import type { DocumentEditState } from '../model/document.ts';
import type { FieldDescriptor, FieldValue } from '../model/fields.ts';
import { get, getDict } from '../inspect/pdfObjects.ts';

const N = PDFName.of;

const labelOf = (field: FieldDescriptor, value: string) =>
  field.options?.find((o) => o.value === value)?.label ?? value;

/** Sets one field from its override. Returns false when the PDF field is missing or of another type. */
function setField(
  form: PDFForm,
  field: FieldDescriptor,
  value: FieldValue,
  text: (s: string) => string,
): boolean {
  const target = form.getFieldMaybe(field.name);
  if (!target) return false;
  switch (field.kind) {
    case 'text':
      if (!(target instanceof PDFTextField) || typeof value !== 'string') return false;
      if (value === '') target.setText(undefined);
      else target.setText(text(value));
      return true;
    case 'checkbox':
      if (!(target instanceof PDFCheckBox) || typeof value !== 'boolean') return false;
      if (value) target.check();
      else target.uncheck();
      return true;
    case 'radio':
      if (typeof value !== 'string') return false;
      if (target instanceof PDFRadioGroup) {
        if (value === '') target.clear();
        else target.select(value);
        return true;
      }
      if (target instanceof PDFCheckBox) {
        selectCheckBoxGroup(target, value);
        return true;
      }
      return false;
    case 'dropdown':
      if (!(target instanceof PDFDropdown) || typeof value !== 'string') return false;
      // After flattening only the appearance remains, so select the label readers would show.
      if (value === '') target.clear();
      else target.select(text(labelOf(field, value)));
      return true;
    case 'list':
      if (!(target instanceof PDFOptionList) || !Array.isArray(value)) return false;
      if (value.length === 0) target.clear();
      else target.select(value.map((v) => text(labelOf(field, v))));
      return true;
    default:
      return false;
  }
}

/** A checkbox field whose widgets have distinct on-states, used as a radio group (spec §6.3). */
function selectCheckBoxGroup(field: PDFCheckBox, value: string) {
  field.acroField.dict.set(N('V'), N(value === '' ? 'Off' : value));
  for (const widget of field.acroField.getWidgets()) {
    const on = widget.getOnValue();
    widget.setAppearanceState(on && on.decodeText() === value ? on : N('Off'));
  }
}

/** Whether every widget has a normal appearance for its current state (spec §9.1 step 2.3). */
function hasAppearanceForValue(field: PDFField): boolean {
  return field.acroField.getWidgets().every((widget) => {
    const ap = getDict(widget.dict, 'AP');
    const normal = ap ? get(ap, 'N') : undefined;
    if (normal instanceof PDFStream) return true;
    if (!(normal instanceof PDFDict)) return false;
    const state = get(widget.dict, 'AS');
    if (!(state instanceof PDFName) || state === N('Off')) return true;
    return get(normal, state.decodeText()) !== undefined;
  });
}

interface Updatable {
  defaultUpdateAppearances(font: PDFFont): void;
}

/**
 * Fills the overridden fields, regenerates missing or dirty appearances, flattens every field and
 * removes the form. Read-only and unsupported fields are never set.
 */
export function fillAndFlatten(
  doc: PDFDocument,
  descriptors: readonly FieldDescriptor[],
  state: DocumentEditState,
  font: PDFFont,
  text: (s: string) => string,
): void {
  const form = doc.getForm();
  for (const field of descriptors) {
    if (!field.supported || field.readOnly) continue;
    if (!Object.hasOwn(state.fieldValues, field.name)) continue;
    setField(form, field, state.fieldValues[field.name]!, text);
  }
  for (const field of form.getFields()) {
    if (field instanceof PDFButton) continue;
    if (!form.fieldIsDirty(field.ref) && !hasAppearanceForValue(field)) {
      form.markFieldAsDirty(field.ref);
    }
    if (!form.fieldIsDirty(field.ref)) continue;
    try {
      (field as unknown as Updatable).defaultUpdateAppearances(font);
      form.markFieldAsClean(field.ref);
    } catch {
      // A field pdf-lib cannot draw (an unusual /DA font, say) keeps whatever appearance it had.
    }
  }
  form.flatten({ updateFieldAppearances: false });
  doc.catalog.delete(N('AcroForm'));
}
