// The pinch and wheel zoom state machine (V4, spec §10.4): scale from the distance ratio,
// clamping to 50–300%, the transform during the gesture, the commit and the scroll anchor.
import { describe, expect, it } from 'vitest';
import {
  anchoredScroll,
  clampZoom,
  distance,
  gestureTransform,
  gestureZoom,
  IDLE,
  midpoint,
  pinchReducer,
  pinchScale,
  wheelFactor,
  type PinchState,
} from '../src/features/viewer/gestures/pinch.ts';

const at = (x: number, y: number) => ({ x, y });
const started = (zoom = 1, centre = at(100, 100)): PinchState =>
  pinchReducer(IDLE, { type: 'start', source: 'pointers', zoom, centre });

describe('pinch maths', () => {
  it('scales by the ratio of the finger distance now to at the start', () => {
    expect(distance(at(0, 0), at(3, 4))).toBe(5);
    expect(midpoint(at(0, 0), at(10, 20))).toEqual(at(5, 10));
    expect(pinchScale(100, 250)).toBe(2.5);
    expect(pinchScale(100, 50)).toBe(0.5);
    // Fingers on top of each other give no usable ratio.
    expect(pinchScale(0, 50)).toBe(1);
    expect(pinchScale(100, 0)).toBe(1);
  });

  it('clamps to 50–300%', () => {
    expect(clampZoom(0.2)).toBe(0.5);
    expect(clampZoom(1.7)).toBe(1.7);
    expect(clampZoom(9)).toBe(3);
  });

  it('turns wheel deltas into a zoom factor, up zooming in', () => {
    expect(wheelFactor(0, 0)).toBe(1);
    expect(wheelFactor(-100, 0)).toBeCloseTo(Math.E);
    expect(wheelFactor(100, 0)).toBeCloseTo(1 / Math.E);
    // Lines and pages are larger units; an unknown mode counts as pixels.
    expect(wheelFactor(-1, 1)).toBeCloseTo(wheelFactor(-16, 0));
    expect(wheelFactor(-1, 2)).toBeCloseTo(wheelFactor(-800, 0));
    expect(wheelFactor(-10, 7)).toBeCloseTo(wheelFactor(-10, 0));
  });
});

describe('the gesture reducer', () => {
  it('starts at the zoom shown, follows the fingers and commits the clamped zoom', () => {
    let state = started(1.25, at(100, 200));
    expect(state).toMatchObject({ phase: 'active', startZoom: 1.25, scale: 1 });
    expect(gestureTransform(state)).toEqual({ scale: 1, shift: at(0, 0) });

    state = pinchReducer(state, { type: 'change', scale: 2, centre: at(110, 190) });
    expect(gestureZoom(state)).toBe(2.5);
    expect(gestureTransform(state)).toEqual({ scale: 2, shift: at(10, -10) });

    // Past 300%, the page stops growing and the commit is 300%.
    state = pinchReducer(state, { type: 'change', scale: 10, centre: at(110, 190) });
    expect(gestureTransform(state)!.scale).toBeCloseTo(3 / 1.25);
    expect(gestureZoom(state)).toBe(3);

    state = pinchReducer(state, { type: 'change', scale: 0.1, centre: at(110, 190) });
    expect(gestureZoom(state)).toBe(0.5);

    expect(pinchReducer(state, { type: 'end' })).toBe(IDLE);
  });

  it('rounds the committed zoom to whole percent', () => {
    const state = pinchReducer(started(1), { type: 'change', scale: 1.23456, centre: at(0, 0) });
    expect(gestureZoom(state)).toBe(1.23);
  });

  it('ignores changes with no gesture, bad scales and starts with no zoom', () => {
    expect(pinchReducer(IDLE, { type: 'change', scale: 2, centre: at(0, 0) })).toBe(IDLE);
    const state = started();
    expect(pinchReducer(state, { type: 'change', scale: 0, centre: at(0, 0) })).toBe(state);
    expect(pinchReducer(state, { type: 'change', scale: NaN, centre: at(0, 0) })).toBe(state);
    expect(
      pinchReducer(IDLE, { type: 'start', source: 'gesture', zoom: 0, centre: at(0, 0) }),
    ).toBe(IDLE);
    expect(gestureZoom(IDLE)).toBeNull();
    expect(gestureTransform(IDLE)).toBeNull();
  });

  it('runs a wheel gesture from its first event, anchored where it began', () => {
    const wheel = (deltaY: number, centre = at(50, 60)) =>
      ({ type: 'wheel', deltaY, deltaMode: 0, zoom: 1, centre }) as const;
    let state = pinchReducer(IDLE, wheel(-100));
    expect(state).toMatchObject({ phase: 'active', source: 'wheel', origin: at(50, 60) });
    expect(gestureZoom(state)).toBe(2.72);
    state = pinchReducer(state, wheel(-100, at(500, 500)));
    // Clamped as it goes, so turning back responds at once.
    expect(gestureZoom(state)).toBe(3);
    state = pinchReducer(state, wheel(100));
    expect(gestureZoom(state)).toBeCloseTo(3 / Math.E, 2);
    expect(gestureTransform(state)!.shift).toEqual(at(0, 0));

    // A wheel does not join a finger gesture, and needs a zoom to start.
    const pinch = started();
    expect(pinchReducer(pinch, wheel(-100))).toBe(pinch);
    expect(pinchReducer(IDLE, { ...wheel(-100), zoom: 0 })).toBe(IDLE);
  });
});

describe('the scroll anchor', () => {
  it('keeps the content under the fingers where they ended', () => {
    // The anchor was 100 px into the page at the old zoom; at double zoom it is 200 px in. The
    // page now starts at client x 40, so the anchor is at 240 and should be at 150: scroll 90.
    expect(anchoredScroll({ left: 10, top: 0 }, at(40, 20), at(100, 50), 2, at(150, 70))).toEqual({
      left: 100,
      top: 50,
    });
  });
});
