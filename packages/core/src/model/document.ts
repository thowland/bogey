// Documents, edits and inspection results (spec §4, §6, §7).
import type { FieldDescriptor, FieldValue, FieldValues } from './fields.ts';
import type { PageGeometry } from './geometry.ts';
import type { Overlay, OverlayProps } from './overlays.ts';

export type FormType = 'acroform' | 'xfa' | 'flat';
export type XfaKind = 'none' | 'hybrid' | 'dynamic';

export interface PdfInfo {
  readonly formType: FormType;
  readonly xfa: XfaKind;
  readonly encrypted: boolean;
  /** False when the pdf-lib fork cannot decrypt this file; export then uses page images (spec §9.5). */
  readonly decryptable: boolean;
  readonly pageCount: number;
  readonly pages: readonly PageGeometry[];
  readonly fields: readonly FieldDescriptor[];
  readonly initialValues: FieldValues;
  readonly metadata: { readonly title?: string; readonly author?: string };
}

/** What the user has changed. Field values are overrides only (spec §6.3). */
export interface DocumentEditState {
  readonly fieldValues: FieldValues;
  readonly overlays: readonly Overlay[];
}

export type Edit =
  | { readonly type: 'setField'; readonly name: string; readonly value: FieldValue }
  | { readonly type: 'addOverlay'; readonly overlay: Overlay }
  | { readonly type: 'updateOverlay'; readonly id: string; readonly patch: OverlayProps }
  | { readonly type: 'moveOverlay'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly type: 'deleteOverlay'; readonly id: string };

export interface History {
  readonly past: readonly DocumentEditState[];
  readonly present: DocumentEditState;
  readonly future: readonly DocumentEditState[];
  /** Edits with the same key, close together, fold into one step (spec §7.4). */
  readonly lastCoalesceKey: string | null;
  readonly lastEditAt: number;
  readonly limit: number;
}

export const EMPTY_EDIT_STATE: DocumentEditState = Object.freeze({
  fieldValues: Object.freeze({}),
  overlays: Object.freeze([]),
});
