// Overlay geometry for the screen (spec §5.3, §7.2, O2, O6, O7, O9). Overlays store their anchor
// in unrotated PDF space and their sizes in the upright frame, which is the page as displayed, so
// on screen every box is axis-aligned: only the anchor goes through the page rotation. Everything
// here is pure, in CSS px relative to the page's top-left corner or in PDF units.
import type { Overlay, PageGeometry, Point } from '@bogey/core';
import {
  pdfToScreen,
  scaleFor,
  screenDeltaToPdf,
  screenToPdf,
  snapToGrid,
  uprightOffset,
} from '../../core-bridge/geometry.ts';
import { CHECK, SIGNATURE_DEFAULT_WIDTH, TEXT } from '../../core-bridge/model.ts';
import { layoutText } from '../../core-bridge/text.ts';
import { firstBaseline, lineHeight } from './textMetrics.ts';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Width in points of a text box with no text, so an empty overlay still has something to hold. */
const EMPTY_TEXT_WIDTH = 0.5;

/** Signatures are not made narrower than this, in points. */
export const MIN_SIGNATURE_WIDTH = 12;

/** The overlay's box on screen. */
export function overlayRect(page: PageGeometry, overlay: Overlay, zoom: number): Rect {
  const k = scaleFor(page, zoom);
  const a = pdfToScreen(page, overlay, zoom);
  switch (overlay.type) {
    case 'text':
    case 'date': {
      const { lines, width } = layoutText(overlay.text, overlay.size, overlay.bold);
      return {
        left: a.x,
        top: a.y - firstBaseline(overlay.size) * k,
        width: Math.max(width, EMPTY_TEXT_WIDTH * overlay.size) * k,
        height: lines.length * lineHeight(overlay.size) * k,
      };
    }
    case 'check':
      return {
        left: a.x,
        top: a.y - overlay.size * k,
        width: overlay.size * k,
        height: overlay.size * k,
      };
    case 'signature':
      return {
        left: a.x,
        top: a.y - overlay.height * k,
        width: overlay.width * k,
        height: overlay.height * k,
      };
  }
}

export interface PlacementDefaults {
  id: string;
  page: number;
  textSize: number;
  dateText: string;
  glyph: 'check' | 'x';
  /** The signature to place and its natural size in pixels, for the aspect ratio (O6). */
  signature: { id: string; width: number; height: number } | null;
}

export type PlacementTool = 'text' | 'date' | 'check' | 'signature';

/**
 * The overlay a click at `point` creates (O2, spec §7.2). Text and dates put their baseline-left
 * at the click; checks and signatures are centred on it. The anchor snaps to the grid (O9).
 */
export function placeOverlay(
  tool: PlacementTool,
  page: PageGeometry,
  point: Point,
  zoom: number,
  d: PlacementDefaults,
): Overlay | null {
  const at = screenToPdf(page, point, zoom);
  const base = { id: d.id, page: d.page };
  switch (tool) {
    case 'text':
    case 'date':
      return {
        ...base,
        ...snapToGrid(at),
        type: tool,
        text: tool === 'date' ? d.dateText : '',
        size: clampSize(d.textSize, TEXT.minSize, TEXT.maxSize),
        bold: false,
      };
    case 'check': {
      const size = CHECK.defaultSize;
      return {
        ...base,
        ...snapToGrid(uprightOffset(page.rotate, at, -size / 2, -size / 2)),
        type: 'check',
        glyph: d.glyph,
        size,
      };
    }
    case 'signature': {
      if (!d.signature || d.signature.width <= 0 || d.signature.height <= 0) return null;
      const width = SIGNATURE_DEFAULT_WIDTH;
      const height = (width * d.signature.height) / d.signature.width;
      return {
        ...base,
        ...snapToGrid(uprightOffset(page.rotate, at, -width / 2, -height / 2)),
        type: 'signature',
        width,
        height,
        signatureId: d.signature.id,
      };
    }
  }
}

const clampSize = (size: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(size)));

/** The anchor after a drag of `delta` CSS px on screen, snapped (O7, O9). */
export function movedAnchor(
  page: PageGeometry,
  overlay: Overlay,
  delta: Point,
  zoom: number,
): Point {
  const d = screenDeltaToPdf(page, delta, zoom);
  return snapToGrid({ x: overlay.x + d.x, y: overlay.y + d.y });
}

/** The anchor after a nudge of `right` and `down` points in screen directions (O7). */
export function nudgedAnchor(
  page: PageGeometry,
  overlay: Overlay,
  right: number,
  down: number,
): Point {
  return snapToGrid(uprightOffset(page.rotate, overlay, right, -down));
}

/** What a resize changes: an anchor that keeps the top-left corner still, and the new size. */
export type ResizePatch =
  { x: number; y: number; size: number } | { x: number; y: number; width: number; height: number };

/**
 * The patch for a drag of the bottom-right handle by `delta` CSS px (O7, spec §7.2). The drag is
 * projected onto the box's diagonal, so the box grows in proportion: text and dates change their
 * size in whole points, checks their size, and signatures their width with the aspect locked. The
 * top-left corner stays where it is.
 */
export function resizePatch(
  page: PageGeometry,
  overlay: Overlay,
  delta: Point,
  zoom: number,
): ResizePatch {
  const k = scaleFor(page, zoom);
  const box = overlayRect(page, overlay, zoom);
  const w = box.width / k;
  const h = box.height / k;
  const du = delta.x / k;
  const dv = delta.y / k;
  const factor = Math.max(0, ((w + du) * w + (h + dv) * h) / (w * w + h * h));
  const keepTop = (up: number) => snapToGrid(uprightOffset(page.rotate, overlay, 0, up));
  switch (overlay.type) {
    case 'text':
    case 'date': {
      const size = clampSize(overlay.size * factor, TEXT.minSize, TEXT.maxSize);
      return { ...keepTop(firstBaseline(overlay.size) - firstBaseline(size)), size };
    }
    case 'check': {
      const size = clampSize(overlay.size * factor, CHECK.minSize, CHECK.maxSize);
      return { ...keepTop(overlay.size - size), size };
    }
    case 'signature': {
      const width = Math.max(MIN_SIGNATURE_WIDTH, overlay.width * factor);
      const height = (width * overlay.height) / overlay.width;
      return { ...keepTop(overlay.height - height), width, height };
    }
  }
}

/**
 * The patch for choosing a new size for a text, date or check overlay from the toolbar, keeping the
 * top-left corner still as a resize does. Null for signatures, which resize by dragging only.
 */
export function sizePatch(
  page: PageGeometry,
  overlay: Overlay,
  size: number,
): { x: number; y: number; size: number } | null {
  const keepTop = (up: number) => snapToGrid(uprightOffset(page.rotate, overlay, 0, up));
  switch (overlay.type) {
    case 'text':
    case 'date': {
      const next = clampSize(size, TEXT.minSize, TEXT.maxSize);
      return { ...keepTop(firstBaseline(overlay.size) - firstBaseline(next)), size: next };
    }
    case 'check': {
      const next = clampSize(size, CHECK.minSize, CHECK.maxSize);
      return { ...keepTop(overlay.size - next), size: next };
    }
    case 'signature':
      return null;
  }
}

/** The page point under a screen point, snapped: what `lastPoint` records (N2). */
export const pagePoint = (page: PageGeometry, point: Point, zoom: number): Point =>
  snapToGrid(screenToPdf(page, point, zoom));

/** A tap: under 6 CSS px of movement within 400 ms, so a pan never places anything (spec §7.2). */
export const TAP = Object.freeze({ maxDistance: 6, maxMs: 400 });

export interface PointerSample {
  x: number;
  y: number;
  t: number;
}

export function isTap(down: PointerSample, up: PointerSample): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) < TAP.maxDistance && up.t - down.t < TAP.maxMs;
}

const MAX_LABEL_TEXT = 60;

/** The accessible name of an overlay (spec §13): "Text overlay: John Smith, page 2". */
export function overlayLabel(overlay: Overlay, signatureName?: string): string {
  const where = `page ${overlay.page + 1}`;
  switch (overlay.type) {
    case 'text':
    case 'date': {
      const kind = overlay.type === 'text' ? 'Text' : 'Date';
      const text = overlay.text.replace(/\s+/g, ' ').trim();
      const shown = text.length > MAX_LABEL_TEXT ? `${text.slice(0, MAX_LABEL_TEXT)}…` : text;
      return `${kind} overlay: ${shown || 'empty'}, ${where}`;
    }
    case 'check':
      return `${overlay.glyph === 'check' ? 'Check mark' : 'X mark'} overlay, ${where}`;
    case 'signature':
      return `Signature overlay: ${signatureName ?? 'deleted from the library'}, ${where}`;
  }
}
