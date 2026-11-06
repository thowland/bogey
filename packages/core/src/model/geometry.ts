// Geometry types (spec §4.1, §5). PDF user space: points, origin bottom-left of the unrotated page.
// View space: CSS px, origin top-left of the page as displayed.

/** `[x0, y0, x1, y1]` in PDF points, normalized so that x0 < x1 and y0 < y1. */
export type Box = readonly [x0: number, y0: number, x1: number, y1: number];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A rectangle in view space (CSS px from the top-left of the displayed page). */
export type ScreenRect = Rect;

export type Rotation = 0 | 90 | 180 | 270;

export interface PageGeometry {
  /** 0-based page index. */
  readonly index: number;
  /** Crop box intersected with media box: what readers display. */
  readonly view: Box;
  /** `/Rotate`, clockwise, normalized to a multiple of 90 in [0, 360). */
  readonly rotate: Rotation;
  /** `/UserUnit`, default 1. */
  readonly userUnit: number;
}

export interface WidgetGeometry {
  readonly page: number;
  /** `/Rect` in PDF user space. */
  readonly rect: Box;
  /** `/MK /R`, counterclockwise in page space. */
  readonly mkRotation: Rotation;
  /** The widget's on-state name, for checkboxes and radio buttons. */
  readonly onValue?: string;
}
