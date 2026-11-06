// The stroke model and pointer handling of the draw dialog (spec §8.1, G2), without a canvas.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SignaturePadModel, type PointerSample } from '../src/features/signatures/padModel.ts';
import { drawSegments, INK, type DrawingContext } from '../src/features/signatures/render.ts';
import {
  STROKE,
  StrokeBuilder,
  strokeSegments,
  widthFor,
  type StrokePoint,
} from '../src/features/signatures/stroke.ts';

const sample = (over: Partial<PointerSample> = {}): PointerSample => ({
  pointerId: 1,
  pointerType: 'pen',
  x: 0,
  y: 0,
  pressure: 0.5,
  buttons: 1,
  button: 0,
  ...over,
});

const widths = (model: SignaturePadModel) =>
  model.strokes.map((stroke) => stroke.points.map((p) => p.width));

describe('widthFor', () => {
  it('follows pen pressure from 1.5 to 4 CSS px', () => {
    expect(widthFor('pen', 1)).toBe(4);
    expect(widthFor('pen', 0.2)).toBeCloseTo(2, 9);
    expect(widthFor('pen', 2)).toBe(4);
  });

  it('treats a pen reporting zero pressure as mid pressure', () => {
    expect(widthFor('pen', 0)).toBe(STROKE.penBase + STROKE.penRange * 0.5);
  });

  it('draws mouse and touch at a constant 2.5 px', () => {
    expect(widthFor('mouse', 0.5)).toBe(2.5);
    expect(widthFor('touch', 1)).toBe(2.5);
    expect(widthFor('touch', 0)).toBe(2.5);
  });
});

describe('StrokeBuilder', () => {
  const p = (x: number, y: number, width = 2): StrokePoint => ({ x, y, width });

  it('starts with a dot, then a line to the first midpoint, then quads through midpoints', () => {
    const builder = new StrokeBuilder();
    expect(builder.add(p(0, 0, 2))).toEqual([{ kind: 'dot', at: p(0, 0, 2), width: 2 }]);
    expect(builder.add(p(10, 0, 4))).toEqual([
      { kind: 'line', from: p(0, 0, 2), to: p(5, 0, 3), width: 2.5 },
    ]);
    expect(builder.add(p(10, 10, 2))).toEqual([
      { kind: 'quad', from: p(5, 0, 3), control: p(10, 0, 4), to: p(10, 5, 3), width: 3 },
    ]);
    expect(builder.end()).toEqual([
      { kind: 'line', from: p(10, 5, 3), to: p(10, 10, 2), width: 2.5 },
    ]);
  });

  it('skips samples that do not move and closes nothing for a single point', () => {
    const builder = new StrokeBuilder();
    builder.add(p(1, 1));
    expect(builder.add(p(1.05, 1))).toEqual([]);
    expect(builder.points).toHaveLength(1);
    expect(builder.end()).toEqual([]);
  });

  it('produces the same segments incrementally as all at once', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.double({ min: 0, max: 900, noNaN: true }),
            y: fc.double({ min: 0, max: 300, noNaN: true }),
            width: fc.double({ min: 1.5, max: 4, noNaN: true }),
          }),
          { maxLength: 40 },
        ),
        (points) => {
          const builder = new StrokeBuilder();
          const incremental = [...points.flatMap((pt) => builder.add(pt)), ...builder.end()];
          const segments = strokeSegments(builder.points);
          // Every segment's width lies between the narrowest and widest point.
          const ws = builder.points.map((pt) => pt.width);
          const inRange = segments.every(
            (s) => s.width >= Math.min(...ws) - 1e-9 && s.width <= Math.max(...ws) + 1e-9,
          );
          return JSON.stringify(incremental) === JSON.stringify(segments) && inRange;
        },
      ),
    );
  });
});

describe('SignaturePadModel', () => {
  it('records pen strokes with pressure-driven widths', () => {
    const model = new SignaturePadModel();
    expect(model.isEmpty).toBe(true);
    expect(model.down(sample({ pressure: 0.2 }))).toMatchObject({ draw: [{ kind: 'dot' }] });
    expect(model.drawing).toBe(true);
    model.move([sample({ x: 5, pressure: 0.6 }), sample({ x: 10, pressure: 1 })]);
    // A pen reporting 0 with the button down draws at mid pressure.
    model.move([sample({ x: 15, pressure: 0 })]);
    expect(model.up(sample())).toMatchObject({ draw: [{ kind: 'line' }] });
    expect(model.drawing).toBe(false);
    const [stroke] = widths(model);
    expect(stroke![0]).toBeCloseTo(2, 9);
    expect(stroke![1]).toBeCloseTo(3, 9);
    expect(stroke![2]).toBe(4);
    expect(stroke![3]).toBe(2.75);
    expect(model.isEmpty).toBe(false);
  });

  it('draws mouse and touch strokes at a constant width', () => {
    const model = new SignaturePadModel();
    model.down(sample({ pointerType: 'mouse', pressure: 0.5 }));
    model.move([sample({ pointerType: 'mouse', x: 20, pressure: 0.5 })]);
    model.up(sample());
    model.down(sample({ pointerId: 2, pointerType: 'touch', pressure: 1 }));
    model.move([sample({ pointerId: 2, pointerType: 'touch', y: 20, pressure: 0.1 })]);
    model.up(sample({ pointerId: 2 }));
    expect(widths(model)).toEqual([
      [2.5, 2.5],
      [2.5, 2.5],
    ]);
  });

  it('ignores secondary mouse buttons, hover and other pointers', () => {
    const model = new SignaturePadModel();
    expect(model.down(sample({ pointerType: 'mouse', button: 2 }))).toBeNull();
    expect(model.move([sample({ x: 5 })])).toBeNull(); // no stroke yet
    model.down(sample());
    expect(model.move([sample({ x: 5, buttons: 0 })])).toBeNull(); // hover
    expect(model.move([sample({ pointerId: 9, x: 5 })])).toBeNull();
    expect(model.down(sample({ pointerId: 3, pointerType: 'mouse' }))).toBeNull();
    expect(model.up(sample({ pointerId: 9 }))).toBeNull();
    model.up(sample());
    expect(model.strokes[0]!.points).toHaveLength(1);
  });

  it('ignores touch while a pen stroke is in progress', () => {
    const model = new SignaturePadModel();
    model.down(sample({ pressure: 0.5 }));
    expect(model.down(sample({ pointerId: 7, pointerType: 'touch' }))).toBeNull();
    model.move([sample({ pointerId: 7, pointerType: 'touch', x: 40 }), sample({ x: 10 })]);
    expect(model.up(sample({ pointerId: 7 }))).toBeNull();
    model.up(sample());
    expect(model.strokes).toHaveLength(1);
    expect(model.strokes[0]!.points.map((p) => p.x)).toEqual([0, 10]);
  });

  it('drops a touch stroke when a pen lands during it, as a wrist arriving first', () => {
    const model = new SignaturePadModel();
    model.down(sample({ pointerId: 1, pointerType: 'mouse' }));
    model.up(sample({ pointerId: 1 }));
    model.down(sample({ pointerId: 7, pointerType: 'touch', x: 100 }));
    model.move([sample({ pointerId: 7, pointerType: 'touch', x: 120 })]);
    const update = model.down(sample({ pointerId: 2, x: 50 }));
    expect(update && 'redraw' in update).toBe(true);
    // The redraw holds the earlier mouse stroke plus the new pen dot, and not the touch.
    expect(update && 'redraw' in update && update.redraw.map((s) => s.kind)).toEqual([
      'dot',
      'dot',
    ]);
    expect(model.strokes.map((s) => s.pointerType)).toEqual(['mouse', 'pen']);
    expect(model.up(sample({ pointerId: 7 }))).toBeNull();
  });

  it('redraws a stroke in progress without its closing segment, and clears', () => {
    const model = new SignaturePadModel();
    model.down(sample());
    model.move([sample({ x: 10 }), sample({ x: 20 })]);
    expect(model.allSegments().map((s) => s.kind)).toEqual(['dot', 'line', 'quad']);
    model.up(sample());
    expect(model.allSegments().map((s) => s.kind)).toEqual(['dot', 'line', 'quad', 'line']);
    model.clear();
    expect(model.isEmpty).toBe(true);
    expect(model.allSegments()).toEqual([]);
  });
});

describe('drawSegments', () => {
  it('fills dots and strokes lines and curves at their own widths', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : (...args: unknown[]) => calls.push(`${key}(${args.join(',')})`),
      set: (target, key: string, value) => {
        target[key] = value;
        if (key === 'lineWidth') calls.push(`width=${value}`);
        return true;
      },
    }) as unknown as DrawingContext;
    const pt = (x: number) => ({ x, y: 0, width: 2 });
    drawSegments(ctx, [
      { kind: 'dot', at: pt(1), width: 2 },
      { kind: 'line', from: pt(1), to: pt(2), width: 3 },
      { kind: 'quad', from: pt(2), control: pt(3), to: pt(4), width: 4 },
    ]);
    expect(ctx.strokeStyle).toBe(INK);
    expect(ctx.lineCap).toBe('round');
    expect(calls).toEqual([
      'beginPath()',
      `arc(1,0,1,0,${Math.PI * 2})`,
      'fill()',
      'beginPath()',
      'width=3',
      'moveTo(1,0)',
      'lineTo(2,0)',
      'stroke()',
      'beginPath()',
      'width=4',
      'moveTo(2,0)',
      'quadraticCurveTo(3,0,4,0)',
      'stroke()',
    ]);
  });
});
