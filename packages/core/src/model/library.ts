// Signature library and snippet profile (spec §8.3, §10.6).

export type SignatureKind = 'signature' | 'initials';

export interface SignatureMeta {
  readonly id: string;
  readonly name: string;
  readonly kind: SignatureKind;
  /** Natural size in pixels. */
  readonly width: number;
  readonly height: number;
  readonly createdAt: number;
}

export interface Snippet {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly order: number;
}

export interface SnippetFileV1 {
  readonly bogeySnippets: 1;
  readonly exportedAt: string;
  readonly snippets: readonly { readonly label: string; readonly value: string }[];
}

/** N1: seeded on first run, empty until the user fills them in. */
export const DEFAULT_SNIPPET_LABELS: readonly string[] = [
  'Full name',
  'Address line 1',
  'Address line 2',
  'City/State/ZIP',
  'Phone',
  'Email',
];
