// Signature pixel operations (spec §8.1, §8.2, §14.3) on synthetic RGBA buffers.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NEAR_WHITE, alphaBounds, cropRgba, luminance709, removeNearWhite } from '../src/index.ts';

/** A w × h buffer filled with one RGBA color. */
function solid(w: number, h: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return data;
}

const grey = (level: number): [number, number, number, number] => [level, level, level, 255];

describe('luminance709', () => {
  it('weights the channels by Rec. 709', () => {
    expect(luminance709(255, 255, 255)).toBeCloseTo(255, 9);
    expect(luminance709(0, 0, 0)).toBe(0);
    expect(luminance709(255, 0, 0)).toBeCloseTo(0.2126 * 255, 9);
    expect(luminance709(0, 255, 0)).toBeCloseTo(0.7152 * 255, 9);
    expect(luminance709(0, 0, 255)).toBeCloseTo(0.0722 * 255, 9);
  });
});

describe('removeNearWhite', () => {
  it('has the slider range from the spec', () => {
    expect(NEAR_WHITE).toEqual({ min: 180, max: 250, default: 235, ramp: 16 });
  });

  it('clears pixels at or above the threshold', () => {
    const data = new Uint8ClampedArray([...grey(235), ...grey(255), ...grey(240)]);
    removeNearWhite(data, 3, 1, 235);
    expect([data[3], data[7], data[11]]).toEqual([0, 0, 0]);
    // Color channels stay as they were.
    expect([...data.subarray(0, 3)]).toEqual([235, 235, 235]);
  });

  it('ramps alpha over the 16 levels below the threshold', () => {
    const data = new Uint8ClampedArray([...grey(227), ...grey(234), ...grey(220), ...grey(219)]);
    removeNearWhite(data, 4, 1, 235);
    expect(data[3]).toBe(Math.round((255 * 8) / 16)); // halfway down the ramp
    expect(data[7]).toBe(Math.round(255 / 16)); // one level below the threshold
    expect(data[11]).toBe(Math.round((255 * 15) / 16));
    expect(data[15]).toBe(255); // 16 levels below: untouched
  });

  it('scales existing alpha rather than replacing it', () => {
    const data = new Uint8ClampedArray([227, 227, 227, 100, 0, 0, 0, 0]);
    removeNearWhite(data, 2, 1, 235);
    expect(data[3]).toBe(50);
    expect(data[7]).toBe(0);
  });

  it('rejects a buffer that does not match its size', () => {
    expect(() => removeNearWhite(new Uint8ClampedArray(8), 3, 1, 235)).toThrow(RangeError);
    expect(() => removeNearWhite(new Uint8ClampedArray(0), -1, 0, 235)).toThrow(RangeError);
    expect(() => removeNearWhite(new Uint8ClampedArray(4), 0.5, 2, 235)).toThrow(RangeError);
  });

  it('is monotone: a lighter pixel never keeps more alpha than a darker one', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: NEAR_WHITE.min, max: NEAR_WHITE.max }),
        (a, b, threshold) => {
          const [dark, light] = a <= b ? [a, b] : [b, a];
          const data = new Uint8ClampedArray([...grey(dark), ...grey(light)]);
          removeNearWhite(data, 2, 1, threshold);
          return data[7]! <= data[3]!;
        },
      ),
    );
  });

  it('leaves pixels darker than threshold − 16 untouched', () => {
    fc.assert(
      fc.property(
        fc.uint8ClampedArray({ minLength: 4, maxLength: 4 * 64 }).filter((d) => d.length % 4 === 0),
        fc.integer({ min: NEAR_WHITE.min, max: NEAR_WHITE.max }),
        (data, threshold) => {
          const before = data.slice();
          removeNearWhite(data, data.length / 4, 1, threshold);
          for (let i = 0; i < data.length; i += 4) {
            const lum = luminance709(before[i]!, before[i + 1]!, before[i + 2]!);
            if (lum <= threshold - NEAR_WHITE.ramp) {
              if (data[i + 3] !== before[i + 3]) return false;
            } else if (data[i + 3]! > before[i + 3]!) {
              return false;
            }
            for (let c = 0; c < 3; c += 1) if (data[i + c] !== before[i + c]) return false;
          }
          return true;
        },
      ),
    );
  });
});

describe('alphaBounds', () => {
  it('returns null when nothing is visible', () => {
    expect(alphaBounds(solid(4, 3, [0, 0, 0, 0]), 4, 3, 2)).toBeNull();
    expect(alphaBounds(new Uint8ClampedArray(0), 0, 0, 2)).toBeNull();
  });

  it('finds the visible box and pads it, clipped to the image', () => {
    const data = solid(10, 8, [0, 0, 0, 0]);
    const set = (x: number, y: number) => (data[(y * 10 + x) * 4 + 3] = 1);
    set(3, 2);
    set(6, 4);
    expect(alphaBounds(data, 10, 8, 0)).toEqual({ x: 3, y: 2, width: 4, height: 3 });
    expect(alphaBounds(data, 10, 8, 1)).toEqual({ x: 2, y: 1, width: 6, height: 5 });
    expect(alphaBounds(data, 10, 8, 8)).toEqual({ x: 0, y: 0, width: 10, height: 8 });
    // Fractional and negative padding are rounded and floored at zero.
    expect(alphaBounds(data, 10, 8, 1.4)).toEqual({ x: 2, y: 1, width: 6, height: 5 });
    expect(alphaBounds(data, 10, 8, -3)).toEqual({ x: 3, y: 2, width: 4, height: 3 });
  });

  it('contains every visible pixel and stays inside the image', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 6 }),
        fc.integer({ min: 0, max: 10 }),
        (w, h, points, pad) => {
          const data = solid(w, h, [0, 0, 0, 0]);
          const visible = points.map(([px, py]) => [px % w, py % h] as const);
          for (const [x, y] of visible) data[(y * w + x) * 4 + 3] = 255;
          const box = alphaBounds(data, w, h, pad);
          if (visible.length === 0) return box === null;
          if (!box) return false;
          const inside =
            box.x >= 0 && box.y >= 0 && box.x + box.width <= w && box.y + box.height <= h;
          return (
            inside &&
            visible.every(
              ([x, y]) =>
                x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height,
            )
          );
        },
      ),
    );
  });
});

describe('cropRgba', () => {
  it('copies the rows inside the rectangle', () => {
    const data = new Uint8ClampedArray(3 * 2 * 4).map((_, i) => i);
    const out = cropRgba(data, 3, 2, { x: 1, y: 0, width: 2, height: 2 });
    expect([...out]).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(cropRgba(data, 3, 2, { x: 0, y: 0, width: 0, height: 0 })).toHaveLength(0);
  });

  it('rejects rectangles outside the image', () => {
    const data = new Uint8ClampedArray(3 * 2 * 4);
    for (const rect of [
      { x: 2, y: 0, width: 2, height: 1 },
      { x: 0, y: 1, width: 1, height: 2 },
      { x: -1, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1.5, height: 1 },
      { x: 0, y: -1, width: 1, height: 1 },
      { x: 0, y: 0, width: -1, height: 1 },
      { x: 0, y: 0, width: 1, height: -1 },
    ]) {
      expect(() => cropRgba(data, 3, 2, rect)).toThrow(RangeError);
    }
  });
});
