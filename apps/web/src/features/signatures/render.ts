// Draws stroke segments on a 2D canvas context (spec §8.1). The context is already scaled to
// device pixels, so segments stay in CSS px.
import type { Segment } from './stroke.ts';

/** The drawing calls this module uses, so tests can record them. */
export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'strokeStyle'
  | 'fillStyle'
>;

/** Ink color: near-black, which reads as a pen signature on any page. */
export const INK = '#1a1a2e';

export function drawSegments(ctx: DrawingContext, segments: readonly Segment[]): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  for (const segment of segments) {
    ctx.beginPath();
    if (segment.kind === 'dot') {
      ctx.arc(segment.at.x, segment.at.y, segment.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.lineWidth = segment.width;
    ctx.moveTo(segment.from.x, segment.from.y);
    if (segment.kind === 'line') ctx.lineTo(segment.to.x, segment.to.y);
    else ctx.quadraticCurveTo(segment.control.x, segment.control.y, segment.to.x, segment.to.y);
    ctx.stroke();
  }
}
