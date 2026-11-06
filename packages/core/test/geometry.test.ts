// Geometry (spec §5, §14.3, X1–X4).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  normalizeBox,
  normalizeRotation,
  pageGeometry,
  pdfRectToScreen,
  pdfToScreen,
  screenDeltaToPdf,
  screenToPdf,
  snapToGrid,
  uprightAxes,
  uprightOffset,
  viewSize,
  widgetScreenRect,
  type PageGeometry,
  type Rotation,
} from '../src/index.ts';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

export const arbPage = fc
  .record({
    x0: fc.double({ min: -2000, max: 2000, noNaN: true }),
    y0: fc.double({ min: -2000, max: 2000, noNaN: true }),
    w: fc.double({ min: 1, max: 3000, noNaN: true }),
    h: fc.double({ min: 1, max: 3000, noNaN: true }),
    rotate: fc.constantFrom(...ROTATIONS),
    userUnit: fc.constantFrom(1, 2),
  })
  .map(({ x0, y0, w, h, rotate, userUnit }): PageGeometry => ({
    index: 0,
    view: [x0, y0, x0 + w, y0 + h],
    rotate,
    userUnit,
  }));
const arbZoom = fc.double({ min: 0.5, max: 3, noNaN: true });
const arbPointIn = (page: PageGeometry) =>
  fc.record({
    x: fc.double({ min: page.view[0], max: page.view[2], noNaN: true }),
    y: fc.double({ min: page.view[1], max: page.view[3], noNaN: true }),
  });

describe('pageGeometry', () => {
  it('normalizes boxes, rotation and user unit', () => {
    expect(pageGeometry({ mediaBox: [612, 792, 0, 0], rotate: -90, userUnit: 0 })).toEqual({
      index: 0,
      view: [0, 0, 612, 792],
      rotate: 270,
      userUnit: 1,
    });
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(45)).toBe(0);
    expect(normalizeRotation(undefined)).toBe(0);
    expect(normalizeRotation(Number.NaN)).toBe(0);
    expect(normalizeBox([5])).toEqual([0, 0, 5, 0]);
  });

  it('intersects the crop box with the media box', () => {
    const g = pageGeometry({ index: 3, mediaBox: [0, 0, 700, 900], cropBox: [50, 80, 662, 2000] });
    expect(g.view).toEqual([50, 80, 662, 900]);
    expect(g.index).toBe(3);
    // A crop box outside the media box is ignored, as readers do.
    expect(
      pageGeometry({ mediaBox: [0, 0, 100, 100], cropBox: [200, 200, 300, 300] }).view,
    ).toEqual([0, 0, 100, 100]);
    expect(pageGeometry({ mediaBox: [0, 0, 10, 10], userUnit: 2 }).userUnit).toBe(2);
  });
});

describe('conversions', () => {
  const letter = (rotate: Rotation): PageGeometry => ({
    index: 0,
    view: [0, 0, 612, 792],
    rotate,
    userUnit: 1,
  });

  it('match the table in spec §5.2 at the corners', () => {
    const k = 4 / 3;
    expect(viewSize(letter(0), 1)).toEqual({ width: 612 * k, height: 792 * k });
    expect(viewSize(letter(90), 1)).toEqual({ width: 792 * k, height: 612 * k });
    expect(pdfToScreen(letter(0), { x: 0, y: 792 }, 1)).toEqual({ x: 0, y: 0 });
    expect(pdfToScreen(letter(90), { x: 0, y: 0 }, 1)).toEqual({ x: 0, y: 0 });
    expect(pdfToScreen(letter(180), { x: 612, y: 0 }, 1)).toEqual({ x: 0, y: 0 });
    expect(pdfToScreen(letter(270), { x: 612, y: 792 }, 1)).toEqual({ x: 0, y: 0 });
  });

  it('round-trip within 1e-9 pt (spec §5.5)', () => {
    fc.assert(
      fc.property(
        arbPage.chain((page) => fc.tuple(fc.constant(page), arbPointIn(page), arbZoom)),
        ([page, p, zoom]) => {
          const back = screenToPdf(page, pdfToScreen(page, p, zoom), zoom);
          expect(Math.abs(back.x - p.x)).toBeLessThan(1e-9 * Math.max(1, Math.abs(p.x)));
          expect(Math.abs(back.y - p.y)).toBeLessThan(1e-9 * Math.max(1, Math.abs(p.y)));
        },
      ),
    );
  });

  it('map the view box onto the displayed page', () => {
    fc.assert(
      fc.property(arbPage, arbZoom, (page, zoom) => {
        const size = viewSize(page, zoom);
        const r = pdfRectToScreen(page, page.view, zoom);
        expect(r.x).toBeCloseTo(0, 6);
        expect(r.y).toBeCloseTo(0, 6);
        expect(r.width).toBeCloseTo(size.width, 6);
        expect(r.height).toBeCloseTo(size.height, 6);
      }),
    );
  });

  it('move deltas like the absolute mapping, without the offset (O7)', () => {
    fc.assert(
      fc.property(
        arbPage.chain((page) => fc.tuple(fc.constant(page), arbPointIn(page), arbZoom)),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        ([page, p, zoom], dx, dy) => {
          const s = pdfToScreen(page, p, zoom);
          const moved = screenToPdf(page, { x: s.x + dx, y: s.y + dy }, zoom);
          const d = screenDeltaToPdf(page, { x: dx, y: dy }, zoom);
          expect(moved.x - p.x).toBeCloseTo(d.x, 6);
          expect(moved.y - p.y).toBeCloseTo(d.y, 6);
        },
      ),
    );
  });

  it('put "right on screen" along the upright frame axis (spec §5.3)', () => {
    for (const rotate of ROTATIONS) {
      const page = letter(rotate);
      const right = screenDeltaToPdf(page, { x: 1, y: 0 }, 0.75);
      const down = screenDeltaToPdf(page, { x: 0, y: 1 }, 0.75);
      const axes = uprightAxes(rotate);
      expect(right.x).toBeCloseTo(axes.right.x, 9);
      expect(right.y).toBeCloseTo(axes.right.y, 9);
      expect(-down.x).toBeCloseTo(axes.up.x, 9);
      expect(-down.y).toBeCloseTo(axes.up.y, 9);
      expect(uprightOffset(rotate, { x: 10, y: 20 }, 2, 3)).toEqual({
        x: 10 + 2 * axes.right.x + 3 * axes.up.x,
        y: 20 + 2 * axes.right.y + 3 * axes.up.y,
      });
    }
  });
});

describe('widgetScreenRect', () => {
  it('returns the net on-screen content rotation (spec §5.4)', () => {
    const page: PageGeometry = { index: 0, view: [0, 0, 612, 792], rotate: 90, userUnit: 1 };
    const same = widgetScreenRect(page, { page: 0, rect: [100, 100, 200, 120], mkRotation: 90 }, 1);
    expect(same.rotation).toBe(0);
    expect(same.width).toBeCloseTo((20 * 4) / 3, 9);
    expect(same.height).toBeCloseTo((100 * 4) / 3, 9);
    expect(widgetScreenRect(page, { page: 0, rect: [0, 0, 1, 1], mkRotation: 0 }, 1).rotation).toBe(
      90,
    );
    const upright = { ...page, rotate: 0 as const };
    expect(
      widgetScreenRect(upright, { page: 0, rect: [0, 0, 1, 1], mkRotation: 90 }, 1).rotation,
    ).toBe(270);
  });
});

describe('snapToGrid', () => {
  it('rounds to the nearest grid point (O9)', () => {
    expect(snapToGrid({ x: 10.4, y: -0.4 })).toEqual({ x: 10, y: 0 });
    expect(snapToGrid({ x: 10.6, y: 3 }, 5)).toEqual({ x: 10, y: 5 });
    expect(snapToGrid({ x: 1.5, y: 2.5 }, 0)).toEqual({ x: 2, y: 3 });
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        (x, y) => {
          const s = snapToGrid({ x, y });
          expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
          expect(Math.abs(s.x - x)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(s.y - y)).toBeLessThanOrEqual(0.5);
        },
      ),
    );
  });
});
