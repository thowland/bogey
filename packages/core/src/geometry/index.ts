// Geometry (spec §5, X1–X4). PDF user space is points with the origin at the bottom-left of the
// unrotated page; view space is CSS px with the origin at the top-left of the page as displayed.
// Every function here is pure and works in doubles; only snapToGrid rounds (spec §5.5).
import type {
  Box,
  PageGeometry,
  Point,
  Rotation,
  ScreenRect,
  WidgetGeometry,
} from '../model/geometry.ts';

/** CSS px per point at zoom 1 (spec §5.1): physical size, matching pdf.js PDF_TO_CSS_UNITS. */
export const CSS_PX_PER_PT = 96 / 72;

/** `/Rotate` normalized to [0, 360); values that are not multiples of 90 count as 0, as in pdf.js. */
export function normalizeRotation(value: number | undefined): Rotation {
  if (value === undefined || !Number.isFinite(value) || value % 90 !== 0) return 0;
  return (((value % 360) + 360) % 360) as Rotation;
}

/** Orders a box's corners so that x0 < x1 and y0 < y1. */
export function normalizeBox(box: readonly number[]): Box {
  const [a = 0, b = 0, c = 0, d = 0] = box;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/** The displayed area: the crop box intersected with the media box (empty intersections fall back to the media box). */
export function pageGeometry(raw: {
  index?: number | undefined;
  mediaBox: readonly number[];
  cropBox?: readonly number[] | undefined;
  rotate?: number | undefined;
  userUnit?: number | undefined;
}): PageGeometry {
  const media = normalizeBox(raw.mediaBox);
  let view = media;
  if (raw.cropBox) {
    const crop = normalizeBox(raw.cropBox);
    const x0 = Math.max(media[0], crop[0]);
    const y0 = Math.max(media[1], crop[1]);
    const x1 = Math.min(media[2], crop[2]);
    const y1 = Math.min(media[3], crop[3]);
    if (x1 > x0 && y1 > y0) view = [x0, y0, x1, y1];
  }
  const userUnit =
    raw.userUnit !== undefined && Number.isFinite(raw.userUnit) && raw.userUnit > 0
      ? raw.userUnit
      : 1;
  return { index: raw.index ?? 0, view, rotate: normalizeRotation(raw.rotate), userUnit };
}

/** CSS px per point at this zoom (spec §5.1). */
export const scaleFor = (page: PageGeometry, zoom: number): number =>
  zoom * CSS_PX_PER_PT * page.userUnit;

const isQuarterTurn = (rotate: Rotation) => rotate === 90 || rotate === 270;

/** The page's displayed size in CSS px. */
export function viewSize(page: PageGeometry, zoom: number): { width: number; height: number } {
  const k = scaleFor(page, zoom);
  const w = (page.view[2] - page.view[0]) * k;
  const h = (page.view[3] - page.view[1]) * k;
  return isQuarterTurn(page.rotate) ? { width: h, height: w } : { width: w, height: h };
}

/** The table in spec §5.2. */
export function pdfToScreen(page: PageGeometry, pt: Point, zoom: number): Point {
  const k = scaleFor(page, zoom);
  const [vx0, vy0, vx1, vy1] = page.view;
  switch (page.rotate) {
    case 0:
      return { x: (pt.x - vx0) * k, y: (vy1 - pt.y) * k };
    case 90:
      return { x: (pt.y - vy0) * k, y: (pt.x - vx0) * k };
    case 180:
      return { x: (vx1 - pt.x) * k, y: (pt.y - vy0) * k };
    case 270:
      return { x: (vy1 - pt.y) * k, y: (vx1 - pt.x) * k };
  }
}

/** The inverse of pdfToScreen. */
export function screenToPdf(page: PageGeometry, px: Point, zoom: number): Point {
  const k = scaleFor(page, zoom);
  const [vx0, vy0, vx1, vy1] = page.view;
  const u = px.x / k;
  const v = px.y / k;
  switch (page.rotate) {
    case 0:
      return { x: vx0 + u, y: vy1 - v };
    case 90:
      return { x: vx0 + v, y: vy0 + u };
    case 180:
      return { x: vx1 - u, y: vy0 + v };
    case 270:
      return { x: vx1 - v, y: vy1 - u };
  }
}

/** Maps two opposite corners and normalizes (spec §5.2). */
export function pdfRectToScreen(page: PageGeometry, rect: Box, zoom: number): ScreenRect {
  const a = pdfToScreen(page, { x: rect[0], y: rect[1] }, zoom);
  const b = pdfToScreen(page, { x: rect[2], y: rect[3] }, zoom);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * A widget's on-screen box and the clockwise rotation of its content on screen,
 * `(page.rotate − /MK /R) mod 360` (spec §5.4).
 */
export function widgetScreenRect(
  page: PageGeometry,
  widget: WidgetGeometry,
  zoom: number,
): ScreenRect & { rotation: Rotation } {
  const rotation = normalizeRotation(page.rotate - widget.mkRotation);
  return { ...pdfRectToScreen(page, widget.rect, zoom), rotation };
}

/**
 * A screen-space movement as a PDF-space movement: rotation and scale only, no offset, so a nudge
 * to the right on screen moves an overlay right whatever the page rotation (O7).
 */
export function screenDeltaToPdf(page: PageGeometry, d: Point, zoom: number): Point {
  const k = scaleFor(page, zoom);
  const u = d.x / k;
  const v = d.y / k;
  switch (page.rotate) {
    case 0:
      return { x: u, y: -v };
    case 90:
      return { x: v, y: u };
    case 180:
      return { x: -u, y: v };
    case 270:
      return { x: -v, y: -u };
  }
}

/** O9: rounds a stored anchor to the grid (1 pt by default). */
export function snapToGrid(pt: Point, grid = 1): Point {
  const g = grid > 0 && Number.isFinite(grid) ? grid : 1;
  // `+ 0` turns -0 into 0 so snapped values compare and serialize cleanly.
  return { x: Math.round(pt.x / g) * g + 0, y: Math.round(pt.y / g) * g + 0 };
}

/**
 * The upright frame's unit vectors in PDF space (spec §5.3): `right` is the direction text runs,
 * `up` is the direction from baseline to cap height, for a page displayed with this rotation.
 */
export function uprightAxes(rotate: Rotation): { right: Point; up: Point } {
  switch (rotate) {
    case 0:
      return { right: { x: 1, y: 0 }, up: { x: 0, y: 1 } };
    case 90:
      return { right: { x: 0, y: 1 }, up: { x: -1, y: 0 } };
    case 180:
      return { right: { x: -1, y: 0 }, up: { x: 0, y: -1 } };
    case 270:
      return { right: { x: 0, y: -1 }, up: { x: 1, y: 0 } };
  }
}

/** A point `u` right and `v` up of the anchor in the upright frame, in PDF space. */
export function uprightOffset(rotate: Rotation, anchor: Point, u: number, v: number): Point {
  const { right, up } = uprightAxes(rotate);
  return { x: anchor.x + u * right.x + v * up.x, y: anchor.y + u * right.y + v * up.y };
}
