// Trimming (spec §8.1, §8.2, G3): the box around every visible pixel, with padding, and the
// pixels inside it.
import type { Rect } from '../model/geometry.ts';
import { assertBuffer } from './nearWhite.ts';

/**
 * The smallest rectangle containing every pixel with non-zero alpha, grown by `pad` pixels on
 * each side and clipped to the image. Returns null when no pixel is visible.
 */
export function alphaBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  pad: number,
): Rect | null {
  assertBuffer(rgba, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (rgba[row + x * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const p = Math.max(0, Math.round(pad));
  const x0 = Math.max(0, minX - p);
  const y0 = Math.max(0, minY - p);
  const x1 = Math.min(width, maxX + 1 + p);
  const y1 = Math.min(height, maxY + 1 + p);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Copies the pixels inside `rect` (integer, within the image) into a new buffer. */
export function cropRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rect: Rect,
): Uint8ClampedArray {
  assertBuffer(rgba, width, height);
  const { x, y, width: w, height: h } = rect;
  if (
    ![x, y, w, h].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    w < 0 ||
    h < 0 ||
    x + w > width ||
    y + h > height
  ) {
    throw new RangeError('crop rectangle outside the image');
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const start = ((y + row) * width + x) * 4;
    out.set(rgba.subarray(start, start + w * 4), row * w * 4);
  }
  return out;
}
