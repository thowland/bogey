// AcroForm field model (spec §4.1, §6.3).
import type { WidgetGeometry } from './geometry.ts';

export type FieldKind =
  'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

export interface FieldDescriptor {
  /** Fully qualified name; the key into FieldValues. */
  readonly name: string;
  /** `/TU` alternate name, used as the accessible label when present. */
  readonly alternateName?: string;
  readonly kind: FieldKind;
  /** False for button and signature fields (F1: shown as read-only outlines). */
  readonly supported: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly multiline?: boolean;
  readonly comb?: boolean;
  readonly maxLength?: number;
  readonly password?: boolean;
  readonly options?: readonly FieldOption[];
  /** Dropdown with the edit flag (a combo box the user can type into). */
  readonly editable?: boolean;
  readonly multiSelect?: boolean;
  /** Checkbox on-state names and radio options. */
  readonly onValues?: readonly string[];
  /** From `/DA`; 0 means auto-size. */
  readonly fontSize: number;
  readonly textAlign: 'left' | 'center' | 'right';
  /** One per widget annotation, in document order. */
  readonly widgets: readonly WidgetGeometry[];
  /** F6: page index, then the page's /Tabs order, then position in /Annots. */
  readonly tabOrder: number;
}

/** Text and single-choice → string; checkbox → boolean; radio → option or ''; list → string[]. */
export type FieldValue = string | boolean | readonly string[];

/** Always accessed through `Object.hasOwn`: field names come from the document (spec §11.4). */
export type FieldValues = Readonly<Record<string, FieldValue>>;
