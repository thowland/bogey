// Export input and output (spec §9).
import type { Problem } from '../result.ts';
import type { DocumentEditState, PdfInfo } from './document.ts';

export interface SignatureImage {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ExportInput {
  /** The stored original (E1), never a previous export. */
  readonly bytes: Uint8Array;
  readonly password?: string;
  readonly info: PdfInfo;
  readonly state: DocumentEditState;
  /** Images for every signatureId the overlays reference, keyed by id. */
  readonly signatures: ReadonlyMap<string, SignatureImage>;
  readonly options: {
    /** E4: replace characters outside WinAnsi with '?' after the user confirmed. */
    readonly replaceNonWinAnsi: boolean;
    /** Epoch ms, for ModDate. */
    readonly now: number;
  };
}

export interface ExportOutput {
  readonly bytes: Uint8Array;
  /** True when the page-image fallback was used (spec §9.5). */
  readonly rasterized: boolean;
}

export type ExportProblem = Problem;

/** E4 preflight: an overlay or field containing characters Helvetica cannot encode. */
export interface ExportWarning {
  readonly subject:
    | { readonly kind: 'overlay'; readonly id: string; readonly page: number }
    | { readonly kind: 'field'; readonly name: string; readonly page: number };
  readonly characters: readonly string[];
}

export type ExportStage = 'loading' | 'fields' | 'drawing' | 'saving' | 'checking';
