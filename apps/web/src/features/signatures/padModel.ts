// What the signature canvas has drawn, and which pointer events count (spec §8.1, G2). Pure:
// the canvas component turns DOM pointer events into samples and draws what this returns.
import {
  StrokeBuilder,
  strokeSegments,
  widthFor,
  type Segment,
  type StrokePoint,
} from './stroke.ts';

/** The parts of a PointerEvent the model needs, with the position in canvas CSS px. */
export interface PointerSample {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  /** Bitmask of buttons held; 0 means hovering. */
  readonly buttons: number;
  /** The button that changed on pointerdown; 0 is the primary (left) button. */
  readonly button: number;
}

export interface Stroke {
  readonly pointerType: string;
  readonly points: readonly StrokePoint[];
}

/** What the canvas should do after an event: draw new segments, or clear and redraw it all. */
export type PadUpdate = { readonly draw: Segment[] } | { readonly redraw: Segment[] };

interface ActiveStroke {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly builder: StrokeBuilder;
}

const pointOf = (s: PointerSample): StrokePoint => ({
  x: s.x,
  y: s.y,
  width: widthFor(s.pointerType, s.pressure),
});

export class SignaturePadModel {
  private done: Stroke[] = [];
  private active: ActiveStroke | null = null;

  /** Finished strokes, plus the one in progress. */
  get strokes(): readonly Stroke[] {
    const active = this.active;
    return active
      ? [...this.done, { pointerType: active.pointerType, points: active.builder.points }]
      : this.done;
  }

  get isEmpty(): boolean {
    return this.strokes.every((stroke) => stroke.points.length === 0);
  }

  get drawing(): boolean {
    return this.active !== null;
  }

  /** Starts a stroke, or returns null if this pointer should be ignored. */
  down(sample: PointerSample): PadUpdate | null {
    if (sample.pointerType === 'mouse' && sample.button !== 0) return null;
    const active = this.active;
    let redraw = false;
    if (active) {
      // A pen landing while a touch stroke is in progress means the touch was a palm or wrist
      // that arrived first: drop it and let the pen draw.
      if (sample.pointerType !== 'pen' || active.pointerType !== 'touch') return null;
      this.active = null;
      redraw = true;
    }
    const builder = new StrokeBuilder();
    this.active = { pointerId: sample.pointerId, pointerType: sample.pointerType, builder };
    const segments = builder.add(pointOf(sample));
    // allSegments() already includes the new stroke's first point.
    return redraw ? { redraw: this.allSegments() } : { draw: segments };
  }

  /**
   * Extends the active stroke with one event's samples (its coalesced events, where the browser
   * provides them). Samples from other pointers, and hover samples, are ignored.
   */
  move(samples: readonly PointerSample[]): PadUpdate | null {
    const active = this.active;
    if (!active) return null;
    const segments: Segment[] = [];
    for (const sample of samples) {
      if (sample.pointerId !== active.pointerId || sample.buttons === 0) continue;
      segments.push(...active.builder.add(pointOf(sample)));
    }
    return segments.length > 0 ? { draw: segments } : null;
  }

  /** Ends the active stroke if the sample belongs to it (pointerup or pointercancel). */
  up(sample: Pick<PointerSample, 'pointerId'>): PadUpdate | null {
    const active = this.active;
    if (!active || sample.pointerId !== active.pointerId) return null;
    this.active = null;
    this.done.push({ pointerType: active.pointerType, points: active.builder.points });
    return { draw: active.builder.end() };
  }

  clear(): void {
    this.done = [];
    this.active = null;
  }

  /** Segments for everything drawn so far, for a full redraw (after a resize, say). */
  allSegments(): Segment[] {
    return this.strokes.flatMap((stroke) =>
      this.active && stroke.points === this.active.builder.points
        ? // The stroke in progress has no closing segment yet.
          strokeSegments(stroke.points).slice(0, stroke.points.length)
        : strokeSegments(stroke.points),
    );
  }
}
