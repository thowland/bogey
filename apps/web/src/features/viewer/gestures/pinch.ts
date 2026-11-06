// Pinch and wheel zoom as a pure state machine (V4, spec §10.4). A gesture starts at the zoom the
// page is shown at, scales with the fingers (or the wheel), and on release commits one zoom,
// clamped to 50–300%. While it runs the page is only scaled with a CSS transform; the hook in
// usePinchZoom.ts applies what this file decides and re-renders once at the end.
import { MAX_ZOOM, MIN_ZOOM } from '../zoom.ts';

export interface Point {
  x: number;
  y: number;
}

/** Where a gesture comes from: WebKit gesture events, two touch pointers, or Ctrl+wheel. */
export type PinchSource = 'gesture' | 'pointers' | 'wheel';

export type PinchState =
  | { phase: 'idle' }
  | {
      phase: 'active';
      source: PinchSource;
      /** The numeric zoom shown when the gesture began. */
      startZoom: number;
      /** The fingers' scale relative to the start, unclamped. */
      scale: number;
      /** The gesture centre when it began, and now, in client CSS px. */
      origin: Point;
      centre: Point;
    };

export type PinchAction =
  | { type: 'start'; source: PinchSource; zoom: number; centre: Point }
  | { type: 'change'; scale: number; centre: Point }
  | { type: 'wheel'; deltaY: number; deltaMode: number; zoom: number; centre: Point }
  | { type: 'end' };

export const IDLE: PinchState = Object.freeze({ phase: 'idle' });

/** Wheel pixels per e-fold of zoom: a trackpad pinch arrives as small Ctrl+wheel deltas. */
const WHEEL_PIXELS_PER_E = 100;
/** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
const WHEEL_UNIT = [1, 16, 800] as const;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The scale two fingers describe: the ratio of their distance now to their distance at start. */
export function pinchScale(startDistance: number, currentDistance: number): number {
  if (!(startDistance > 0) || !(currentDistance > 0)) return 1;
  return currentDistance / startDistance;
}

/** The zoom factor of one wheel event; scrolling up (negative delta) zooms in. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const unit = WHEEL_UNIT[deltaMode as 0 | 1 | 2] ?? 1;
  return Math.exp((-deltaY * unit) / WHEEL_PIXELS_PER_E);
}

export function pinchReducer(state: PinchState, action: PinchAction): PinchState {
  switch (action.type) {
    case 'start':
      if (!(action.zoom > 0)) return state;
      return {
        phase: 'active',
        source: action.source,
        startZoom: action.zoom,
        scale: 1,
        origin: action.centre,
        centre: action.centre,
      };
    case 'change':
      if (state.phase !== 'active' || !(action.scale > 0)) return state;
      return { ...state, scale: action.scale, centre: action.centre };
    case 'wheel': {
      // Wheel events have no start or end: the first one starts a gesture, and later ones scale
      // it until the hook ends it after a pause. A wheel never joins a finger gesture.
      const factor = wheelFactor(action.deltaY, action.deltaMode);
      if (state.phase === 'idle') {
        if (!(action.zoom > 0)) return state;
        return {
          phase: 'active',
          source: 'wheel',
          startZoom: action.zoom,
          // Kept within the limits, so zooming back from 300% responds at once.
          scale: clampZoom(action.zoom * factor) / action.zoom,
          origin: action.centre,
          centre: action.centre,
        };
      }
      if (state.source !== 'wheel') return state;
      const scale = clampZoom(state.startZoom * state.scale * factor) / state.startZoom;
      // The page stays anchored where the wheel gesture began.
      return { ...state, scale };
    }
    case 'end':
      return IDLE;
  }
}

/** The zoom the page would be shown at if the gesture ended now, rounded to 1%. */
export function gestureZoom(state: PinchState): number | null {
  if (state.phase !== 'active') return null;
  return Math.round(clampZoom(state.startZoom * state.scale) * 100) / 100;
}

/**
 * The CSS transform for the page during a gesture: a scale by the clamped ratio around the point
 * where the gesture began, then a shift that follows the gesture centre.
 */
export function gestureTransform(state: PinchState): { scale: number; shift: Point } | null {
  if (state.phase !== 'active') return null;
  return {
    scale: clampZoom(state.startZoom * state.scale) / state.startZoom,
    shift: { x: state.centre.x - state.origin.x, y: state.centre.y - state.origin.y },
  };
}

/**
 * The scroll position that keeps the content under the gesture where the fingers ended, after
 * the page has been laid out at the new zoom.
 *
 * `anchor` is the point under the gesture's origin, in CSS px from the page's top-left at the old
 * zoom; `ratio` is new zoom / old zoom; `sheet` is the page's position (client px) after layout;
 * `centre` is where the gesture ended (client px). The browser clamps the result to what can be
 * scrolled.
 */
export function anchoredScroll(
  scroll: { left: number; top: number },
  sheet: Point,
  anchor: Point,
  ratio: number,
  centre: Point,
): { left: number; top: number } {
  return {
    left: scroll.left + sheet.x + anchor.x * ratio - centre.x,
    top: scroll.top + sheet.y + anchor.y * ratio - centre.y,
  };
}
