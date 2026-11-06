// The stroke model for the draw dialog (spec §8.1, G2): pointer samples become points with a
// width, and points become segments of a midpoint quadratic Bézier path that can be drawn one
// piece at a time. Pure, so the shape of a stroke is tested without a canvas.

/** A sampled position in CSS px from the canvas's top-left, with the line width there. */
export interface StrokePoint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export type Segment =
  | { readonly kind: 'dot'; readonly at: StrokePoint; readonly width: number }
  | {
      readonly kind: 'line';
      readonly from: StrokePoint;
      readonly to: StrokePoint;
      readonly width: number;
    }
  | {
      readonly kind: 'quad';
      readonly from: StrokePoint;
      readonly control: StrokePoint;
      readonly to: StrokePoint;
      readonly width: number;
    };

export const STROKE = Object.freeze({
  /** Pen width at zero pressure, and how much full pressure adds (CSS px). */
  penBase: 1.5,
  penRange: 2.5,
  /** Mouse and touch report no useful pressure, so they draw at one width. */
  fixedWidth: 2.5,
  /** Pressure used when a pen reports 0 with a button down, which some drivers do. */
  unknownPressure: 0.5,
  /** Samples closer than this to the previous point add nothing (CSS px). */
  minDistance: 0.1,
});

/** Line width in CSS px for a sample from the given kind of pointer. */
export function widthFor(pointerType: string, pressure: number): number {
  if (pointerType !== 'pen') return STROKE.fixedWidth;
  const p = pressure > 0 ? Math.min(1, pressure) : STROKE.unknownPressure;
  return STROKE.penBase + STROKE.penRange * p;
}

const midpoint = (a: StrokePoint, b: StrokePoint): StrokePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  width: (a.width + b.width) / 2,
});

const average = (a: StrokePoint, b: StrokePoint) => (a.width + b.width) / 2;

/**
 * Builds one stroke incrementally. Each call returns only the segments that the new point
 * completes, so the canvas draws one frame's worth of path per event. The segments for a whole
 * stroke are the same whether built incrementally or all at once.
 */
export class StrokeBuilder {
  private readonly pts: StrokePoint[] = [];

  get points(): readonly StrokePoint[] {
    return this.pts;
  }

  /** Adds a point; returns the segments it completes. */
  add(point: StrokePoint): Segment[] {
    const pts = this.pts;
    const last = pts.at(-1);
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < STROKE.minDistance) return [];
    pts.push(point);
    const n = pts.length;
    if (n === 1) return [{ kind: 'dot', at: point, width: point.width }];
    if (n === 2) {
      const to = midpoint(pts[0]!, point);
      return [{ kind: 'line', from: pts[0]!, to, width: average(pts[0]!, to) }];
    }
    const from = midpoint(pts[n - 3]!, pts[n - 2]!);
    const to = midpoint(pts[n - 2]!, point);
    return [{ kind: 'quad', from, control: pts[n - 2]!, to, width: average(from, to) }];
  }

  /** Finishes the stroke; returns the closing segment from the last midpoint to the last point. */
  end(): Segment[] {
    const pts = this.pts;
    const n = pts.length;
    if (n < 2) return [];
    const from = midpoint(pts[n - 2]!, pts[n - 1]!);
    return [{ kind: 'line', from, to: pts[n - 1]!, width: average(from, pts[n - 1]!) }];
  }
}

/** Every segment of a finished stroke, for redrawing it in one go. */
export function strokeSegments(points: readonly StrokePoint[]): Segment[] {
  const builder = new StrokeBuilder();
  const segments = points.flatMap((point) => builder.add(point));
  return [...segments, ...builder.end()];
}
