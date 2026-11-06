// Pinch and wheel zoom on the page area (V4, spec §10.4). The browser pans (the area has
// `touch-action: pan-x pan-y`); Bogey handles the pinch, so iPadOS never zooms the whole app:
// - Safari (iPadOS, and macOS trackpads) sends WebKit gesture events, which are cancelled with
//   preventDefault anywhere in the document; the only reliable way to stop the page zoom.
// - Other touch browsers: two touch pointers are tracked, and a two-finger touchmove is cancelled
//   so the browser does not scroll under the fingers.
// - Desktop: Ctrl+wheel, which is how Chrome, Edge and Firefox deliver a trackpad pinch.
// During the gesture the current page sheet is scaled with a CSS transform (through the CSSOM,
// which the CSP allows); when it ends the zoom is committed once and the page re-renders, with
// the content under the fingers kept in place.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { TIMING } from '../../../config.ts';
import type { Zoom } from '../../../state/persistence.ts';
import { useViewStore } from '../../../state/view.ts';
import {
  anchoredScroll,
  distance,
  gestureTransform,
  gestureZoom,
  IDLE,
  midpoint,
  pinchReducer,
  pinchScale,
  type PinchAction,
  type PinchState,
  type Point,
} from './pinch.ts';

/** The WebKit gesture event fields Bogey reads (not in the DOM typings). */
interface GestureLike extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/** Whether the browser sends WebKit gesture events, so the pointer pinch must stay out of it. */
export const hasGestureEvents = (): boolean => 'GestureEvent' in globalThis;

interface Pending {
  area: HTMLElement;
  sheet: HTMLElement;
  anchor: Point;
  ratio: number;
  centre: Point;
}

/** The page sheet on screen; its neighbors are rendered too, but hidden. */
const currentSheet = (area: HTMLElement): HTMLElement | null =>
  area.querySelector<HTMLElement>('[data-page]:not([hidden])');

function clearTransform(sheet: HTMLElement) {
  sheet.style.transform = '';
  sheet.style.transformOrigin = '';
}

export function usePinchZoom(
  area: RefObject<HTMLElement | null>,
  zoom: Zoom,
  enabled: boolean,
): void {
  const pending = useRef<Pending | null>(null);

  useEffect(() => {
    const element = area.current;
    if (!enabled || !element) return;
    let state: PinchState = IDLE;
    let sheet: HTMLElement | null = null;
    let anchor: Point = { x: 0, y: 0 };

    const apply = () => {
      const transform = gestureTransform(state);
      if (!sheet || !transform) return;
      sheet.style.transform = `translate(${transform.shift.x}px, ${transform.shift.y}px) scale(${transform.scale})`;
    };

    /**
     * Starts a gesture at `centre` (client px) if a page is on screen at a known zoom; `start`
     * builds the starting action from that zoom.
     */
    const begin = (centre: Point, start: (zoom: number) => PinchAction): boolean => {
      const shown = useViewStore.getState().renderedZoom;
      const target = currentSheet(element);
      if (shown === null || !target) return false;
      const box = target.getBoundingClientRect();
      sheet = target;
      anchor = { x: centre.x - box.left, y: centre.y - box.top };
      sheet.style.transformOrigin = `${anchor.x}px ${anchor.y}px`;
      state = pinchReducer(state, start(shown));
      apply();
      return true;
    };

    const update = (action: PinchAction) => {
      state = pinchReducer(state, action);
      apply();
    };

    const finish = () => {
      const committed = gestureZoom(state);
      const ended = state;
      state = pinchReducer(state, { type: 'end' });
      const target = sheet;
      sheet = null;
      if (committed === null || ended.phase !== 'active' || !target) return;
      const view = useViewStore.getState();
      if (view.zoom === committed) {
        clearTransform(target);
        return;
      }
      pending.current = {
        area: element,
        sheet: target,
        anchor,
        ratio: committed / ended.startZoom,
        centre: ended.centre,
      };
      view.setZoom(committed);
    };

    // WebKit gesture events, cancelled everywhere so iPadOS never zooms the app itself.
    const onGesture = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureLike;
      const centre = { x: gesture.clientX, y: gesture.clientY };
      const inside = event.target instanceof Node && element.contains(event.target);
      if (event.type === 'gesturestart') {
        if (inside && state.phase === 'idle') {
          begin(centre, (zoom) => ({ type: 'start', source: 'gesture', zoom, centre }));
        }
      } else if (state.phase === 'active' && state.source === 'gesture') {
        if (event.type === 'gesturechange')
          update({ type: 'change', scale: gesture.scale, centre });
        else finish();
      }
    };

    // Two touch pointers, where there are no gesture events.
    const pointers = new Map<number, Point>();
    let startDistance = 0;
    const pair = (): [Point, Point] | null => {
      const [a, b] = [...pointers.values()];
      return a && b ? [a, b] : null;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      // The first finger down starts afresh, so a lift we never saw cannot leave a stale finger.
      if (event.isPrimary && state.phase === 'idle') pointers.clear();
      if (pointers.size >= 2) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const both = pair();
      if (!both || state.phase !== 'idle') return;
      startDistance = distance(...both);
      const centre = midpoint(...both);
      begin(centre, (zoom) => ({ type: 'start', source: 'pointers', zoom, centre }));
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const both = pair();
      if (!both || state.phase !== 'active' || state.source !== 'pointers') return;
      update({
        type: 'change',
        scale: pinchScale(startDistance, distance(...both)),
        centre: midpoint(...both),
      });
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (state.phase === 'active' && state.source === 'pointers') finish();
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length >= 2) event.preventDefault();
    };

    // Ctrl+wheel: a trackpad pinch in Chrome, Edge and Firefox, or Ctrl and a mouse wheel.
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (state.phase === 'active' && state.source !== 'wheel') return;
      const centre = { x: event.clientX, y: event.clientY };
      const wheel = (zoom: number): PinchAction => ({
        type: 'wheel',
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        zoom,
        centre,
      });
      if (state.phase === 'idle') {
        if (!begin(centre, wheel)) return;
      } else {
        update(wheel(state.startZoom));
      }
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(finish, TIMING.wheelZoomSettleMs);
    };

    const gestures = hasGestureEvents();
    for (const type of GESTURE_EVENTS)
      document.addEventListener(type, onGesture, { passive: false });
    if (!gestures) {
      element.addEventListener('pointerdown', onPointerDown, { capture: true });
      element.addEventListener('pointermove', onPointerMove, { capture: true });
      element.addEventListener('pointerup', onPointerEnd, { capture: true });
      element.addEventListener('pointercancel', onPointerEnd, { capture: true });
    }
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      for (const type of GESTURE_EVENTS) document.removeEventListener(type, onGesture);
      element.removeEventListener('pointerdown', onPointerDown, { capture: true });
      element.removeEventListener('pointermove', onPointerMove, { capture: true });
      element.removeEventListener('pointerup', onPointerEnd, { capture: true });
      element.removeEventListener('pointercancel', onPointerEnd, { capture: true });
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('wheel', onWheel);
      clearTimeout(wheelTimer);
      if (sheet) clearTransform(sheet);
    };
  }, [area, enabled]);

  // The committed zoom has been laid out: drop the transform and scroll so the content under the
  // fingers stays there, before the browser paints.
  useLayoutEffect(() => {
    const done = pending.current;
    if (!done) return;
    pending.current = null;
    clearTransform(done.sheet);
    const element = done.area;
    const box = done.sheet.getBoundingClientRect();
    const next = anchoredScroll(
      { left: element.scrollLeft, top: element.scrollTop },
      { x: box.left, y: box.top },
      done.anchor,
      done.ratio,
      done.centre,
    );
    element.scrollLeft = next.left;
    element.scrollTop = next.top;
  }, [zoom]);
}
