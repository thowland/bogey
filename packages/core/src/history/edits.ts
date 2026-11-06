// The edit reducer (spec §7.3). Every edit is validated against the document's fields and pages;
// an invalid edit returns the state unchanged (the same object), so callers can detect no-ops by
// identity. Field names come from the document and are looked up with Object.hasOwn or a Map,
// never as plain property reads (spec §11.4).
import type { DocumentEditState, Edit, PdfInfo } from '../model/document.ts';
import type { FieldDescriptor, FieldValue } from '../model/fields.ts';
import type { Overlay, OverlayProps } from '../model/overlays.ts';
import { CHECK, TEXT } from '../model/text.ts';

/** What validation needs to know about the document. A PdfInfo satisfies it. */
export type EditContext = Pick<PdfInfo, 'fields' | 'pageCount'>;

export function createEditState(): DocumentEditState {
  return { fieldValues: {}, overlays: [] };
}

const fieldMaps = new WeakMap<readonly FieldDescriptor[], Map<string, FieldDescriptor>>();

/** Descriptors by name, cached per field list. */
export function fieldsByName(fields: readonly FieldDescriptor[]): Map<string, FieldDescriptor> {
  let map = fieldMaps.get(fields);
  if (!map) {
    map = new Map(fields.map((f) => [f.name, f]));
    fieldMaps.set(fields, map);
  }
  return map;
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Whether `value` has the shape `field`'s kind requires (spec §6.3). */
export function isValidFieldValue(field: FieldDescriptor, value: unknown): value is FieldValue {
  switch (field.kind) {
    case 'text':
      return (
        isString(value) && (field.maxLength === undefined || [...value].length <= field.maxLength)
      );
    case 'checkbox':
      return typeof value === 'boolean';
    case 'radio':
      return isString(value) && (value === '' || (field.onValues ?? []).includes(value));
    case 'dropdown':
      return (
        isString(value) &&
        (value === '' ||
          field.editable === true ||
          (field.options ?? []).some((o) => o.value === value))
      );
    case 'list': {
      if (!Array.isArray(value) || !value.every(isString)) return false;
      if (new Set(value).size !== value.length) return false;
      if (field.multiSelect !== true && value.length > 1) return false;
      const options = new Set((field.options ?? []).map((o) => o.value));
      return value.every((v) => options.has(v));
    }
    default:
      return false;
  }
}

const sameValue = (a: FieldValue | undefined, b: FieldValue) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b;

/**
 * A clean copy of an overlay with sizes clamped to their ranges (O3, O4), or null when it cannot
 * be valid on this document. Unknown properties are dropped.
 */
export function normalizeOverlay(o: unknown, pageCount: number): Overlay | null {
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  const { id, page, x, y } = r;
  if (!isString(id) || id === '') return null;
  if (!Number.isInteger(page) || (page as number) < 0 || (page as number) >= pageCount) return null;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const base = { id, page: page as number, x, y };
  switch (r.type) {
    case 'text':
    case 'date':
      if (!isString(r.text) || !isFiniteNumber(r.size) || typeof r.bold !== 'boolean') return null;
      return {
        ...base,
        type: r.type,
        text: r.text,
        size: clamp(r.size, TEXT.minSize, TEXT.maxSize),
        bold: r.bold,
      };
    case 'check':
      if ((r.glyph !== 'check' && r.glyph !== 'x') || !isFiniteNumber(r.size)) return null;
      return {
        ...base,
        type: 'check',
        glyph: r.glyph,
        size: clamp(r.size, CHECK.minSize, CHECK.maxSize),
      };
    case 'signature':
      if (!isString(r.signatureId) || r.signatureId === '') return null;
      if (!isFiniteNumber(r.width) || !isFiniteNumber(r.height)) return null;
      if (r.width <= 0 || r.height <= 0) return null;
      return {
        ...base,
        type: 'signature',
        width: r.width,
        height: r.height,
        signatureId: r.signatureId,
      };
    default:
      return null;
  }
}

/** Property names an update may change, per overlay type. */
const PATCHABLE: Record<Overlay['type'], readonly (keyof OverlayProps)[]> = {
  text: ['x', 'y', 'text', 'size', 'bold'],
  date: ['x', 'y', 'text', 'size', 'bold'],
  check: ['x', 'y', 'glyph', 'size'],
  signature: ['x', 'y', 'width', 'height', 'signatureId'],
};

const sameOverlay = (a: Overlay, b: Overlay) => {
  const ka = Object.keys(a) as (keyof Overlay)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

function replaceOverlay(state: DocumentEditState, index: number, next: Overlay | null) {
  const current = state.overlays[index]!;
  if (next === null || sameOverlay(current, next)) return state;
  const overlays = state.overlays.slice();
  overlays[index] = next;
  return { fieldValues: state.fieldValues, overlays };
}

/** The pure edit reducer (spec §7.3). Returns `state` itself for an invalid or no-op edit. */
export function applyEdit(
  state: DocumentEditState,
  edit: Edit,
  ctx: EditContext,
): DocumentEditState {
  switch (edit.type) {
    case 'setField': {
      const field = isString(edit.name) ? fieldsByName(ctx.fields).get(edit.name) : undefined;
      if (!field || !field.supported || field.readOnly) return state;
      if (!isValidFieldValue(field, edit.value)) return state;
      const current = Object.hasOwn(state.fieldValues, edit.name)
        ? state.fieldValues[edit.name]
        : undefined;
      if (current !== undefined && sameValue(current, edit.value)) return state;
      const value = Array.isArray(edit.value) ? Object.freeze([...edit.value]) : edit.value;
      // A computed key defines an own property even for '__proto__'.
      return {
        fieldValues: { ...state.fieldValues, [edit.name]: value },
        overlays: state.overlays,
      };
    }
    case 'addOverlay': {
      const overlay = normalizeOverlay(edit.overlay, ctx.pageCount);
      if (!overlay || state.overlays.some((o) => o.id === overlay.id)) return state;
      return { fieldValues: state.fieldValues, overlays: [...state.overlays, overlay] };
    }
    case 'updateOverlay': {
      const index = state.overlays.findIndex((o) => o.id === edit.id);
      if (index < 0 || typeof edit.patch !== 'object' || edit.patch === null) return state;
      const current = state.overlays[index]!;
      const merged: Record<string, unknown> = { ...current };
      for (const key of PATCHABLE[current.type]) {
        if (Object.hasOwn(edit.patch, key)) merged[key] = edit.patch[key];
      }
      return replaceOverlay(state, index, normalizeOverlay(merged, ctx.pageCount));
    }
    case 'moveOverlay': {
      const index = state.overlays.findIndex((o) => o.id === edit.id);
      if (index < 0 || !isFiniteNumber(edit.x) || !isFiniteNumber(edit.y)) return state;
      return replaceOverlay(state, index, { ...state.overlays[index]!, x: edit.x, y: edit.y });
    }
    case 'deleteOverlay': {
      const overlays = state.overlays.filter((o) => o.id !== edit.id);
      if (overlays.length === state.overlays.length) return state;
      return { fieldValues: state.fieldValues, overlays };
    }
    default:
      return state;
  }
}
