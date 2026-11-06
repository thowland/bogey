// Free overlays (requirements §9, spec §5.3). `x`, `y` are the visual anchor in unrotated PDF
// points: baseline-left of the first line for text and dates, bottom-left of the box for checks
// and signatures. Sizes are measured in the upright (as-viewed) frame.

export interface TextOverlay {
  readonly id: string;
  readonly type: 'text';
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size: number;
  readonly bold: boolean;
}

export interface DateOverlay {
  readonly id: string;
  readonly type: 'date';
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size: number;
  readonly bold: boolean;
}

export interface CheckOverlay {
  readonly id: string;
  readonly type: 'check';
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly glyph: 'check' | 'x';
  readonly size: number;
}

export interface SignatureOverlay {
  readonly id: string;
  readonly type: 'signature';
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly signatureId: string;
}

export type Overlay = TextOverlay | DateOverlay | CheckOverlay | SignatureOverlay;
export type OverlayType = Overlay['type'];

/** The editable properties of an overlay: everything except identity, kind and page. */
export type OverlayProps = Partial<
  Omit<TextOverlay, 'id' | 'type' | 'page'> &
    Omit<CheckOverlay, 'id' | 'type' | 'page'> &
    Omit<SignatureOverlay, 'id' | 'type' | 'page'>
>;

export const OVERLAY_TYPES: readonly OverlayType[] = ['text', 'date', 'check', 'signature'];
