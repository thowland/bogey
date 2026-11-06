// Background removal for uploaded signatures (spec §8.2, G4). Works in place on an RGBA buffer
// so the app can run it on canvas pixels without copying.

/** Threshold slider range and default, and the width of the soft edge below the threshold. */
export const NEAR_WHITE = Object.freeze({ min: 180, max: 250, default: 235, ramp: 16 });

/** Rec. 709 luminance of an sRGB pixel, 0–255. */
export function luminance709(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Makes near-white pixels transparent. Pixels whose luminance is at or above `threshold` become
 * fully transparent; pixels within `NEAR_WHITE.ramp` levels below it keep a share of their alpha
 * proportional to their distance from the threshold, so anti-aliased ink keeps a soft edge rather
 * than a jagged one. Darker pixels are left as they are. Color channels are never changed.
 */
export function removeNearWhite(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): void {
  assertBuffer(rgba, width, height);
  const ramp = NEAR_WHITE.ramp;
  for (let i = 0; i < rgba.length; i += 4) {
    const lum = luminance709(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    if (lum >= threshold) {
      rgba[i + 3] = 0;
    } else if (lum > threshold - ramp) {
      rgba[i + 3] = Math.round((rgba[i + 3]! * (threshold - lum)) / ramp);
    }
  }
}

/** Throws on programmer error: a buffer that does not match its stated size. */
export function assertBuffer(rgba: Uint8ClampedArray, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`invalid image size ${width} × ${height}`);
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError(`RGBA buffer of ${rgba.length} bytes does not match ${width} × ${height}`);
  }
}
