// Canvas and image I/O for signatures (spec §8.1, §8.2): reading pixels out of canvases and
// decoded images, handing them to core's pixel operations, and encoding the result as PNG.
import type { Problem, Result } from '@bogey/core';
import { LIMITS } from '../../config.ts';
import { alphaBounds, cropRgba, removeNearWhite } from '../../core-bridge/image.ts';

/** RGBA pixels with their size. */
export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** A finished signature image: a transparent PNG and its size in pixels. */
export interface EncodedSignature {
  readonly png: Blob;
  readonly width: number;
  readonly height: number;
}

/** Long edge of the downscaled copy the upload preview works on, for quick slider updates. */
export const PREVIEW_EDGE = 640;

/** Padding around trimmed signatures, in CSS px (spec §8.1, G3). */
export const TRIM_PADDING = 8;

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** All of a canvas's pixels. */
export function readCanvas(canvas: HTMLCanvasElement): Pixels {
  const { width, height } = canvas;
  const image = context(canvas).getImageData(0, 0, width, height);
  return { data: image.data, width, height };
}

/** Writes pixels into a canvas, resizing it to fit. */
export function paintPixels(canvas: HTMLCanvasElement, pixels: Pixels): void {
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  if (pixels.width === 0 || pixels.height === 0) return;
  const ctx = context(canvas);
  const image = ctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  ctx.putImageData(image, 0, 0);
}

/** Encodes pixels as a PNG. */
export function encodePng(pixels: Pixels): Promise<Blob> {
  const canvas = makeCanvas(0, 0);
  paintPixels(canvas, pixels);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
      'image/png',
    );
  });
}

/** Crops pixels to their visible area plus `pad` and encodes them; null if nothing is visible. */
export async function trimAndEncode(pixels: Pixels, pad: number): Promise<EncodedSignature | null> {
  const box = alphaBounds(pixels.data, pixels.width, pixels.height, pad);
  if (!box) return null;
  const data = cropRgba(pixels.data, pixels.width, pixels.height, box);
  const png = await encodePng({ data, width: box.width, height: box.height });
  return { png, width: box.width, height: box.height };
}

/** Size that fits `width` × `height` within `edge` on its long side, never enlarging. */
export function fitWithin(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A decoded upload at working size, and a smaller copy for the preview. */
export interface DecodedUpload {
  readonly full: Pixels;
  readonly preview: Pixels;
}

/**
 * Decodes an uploaded image (spec §8.2, S9). Files over the size limit are refused before
 * decoding. The browser applies EXIF orientation, and the result is scaled so its long edge is
 * at most `LIMITS.maxSignatureEdge`. Only decoded pixels leave this function: the file's bytes,
 * and the metadata in them, are dropped.
 */
export async function decodeUpload(file: Blob): Promise<Result<DecodedUpload, Problem>> {
  if (file.size > LIMITS.maxSignatureUploadBytes) {
    const limitMb = Math.round(LIMITS.maxSignatureUploadBytes / (1024 * 1024));
    return { ok: false, problems: [{ code: 'signature.too-large', data: { limitMb } }] };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    console.warn('Signature image could not be decoded', error);
    return { ok: false, problems: [{ code: 'signature.decode-failed' }] };
  }
  try {
    const full = drawScaled(bitmap, LIMITS.maxSignatureEdge);
    const preview = drawScaled(bitmap, PREVIEW_EDGE);
    return { ok: true, value: { full, preview } };
  } finally {
    bitmap.close();
  }
}

function drawScaled(bitmap: ImageBitmap, edge: number): Pixels {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, edge);
  const canvas = makeCanvas(width, height);
  const ctx = context(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return readCanvas(canvas);
}

/** A copy of `pixels` with the near-white background removed at `threshold`. */
export function withoutBackground(pixels: Pixels, threshold: number): Pixels {
  const data = pixels.data.slice();
  removeNearWhite(data, pixels.width, pixels.height, threshold);
  return { data, width: pixels.width, height: pixels.height };
}
