// Canvas and image I/O for signatures in jsdom's canvas (spec §8.1, §8.2). Real decoding of
// PNG and JPEG files is covered in signatures.browser.test.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/config.ts';
import {
  PREVIEW_EDGE,
  decodeUpload,
  encodePng,
  fitWithin,
  paintPixels,
  readCanvas,
  trimAndEncode,
  withoutBackground,
  type Pixels,
} from '../src/features/signatures/pixels.ts';

/** White pixels with a black rectangle. */
function inkOnWhite(
  width: number,
  height: number,
  ink: { x: number; y: number; w: number; h: number },
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = ink.y; y < ink.y + ink.h; y += 1) {
    for (let x = ink.x; x < ink.x + ink.w; x += 1) data.set([0, 0, 0, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

afterEach(() => vi.unstubAllGlobals());

describe('fitWithin', () => {
  it('scales the long edge down to the limit and never enlarges', () => {
    expect(fitWithin(4000, 1000, 2000)).toEqual({ width: 2000, height: 500 });
    expect(fitWithin(1000, 3000, 2000)).toEqual({ width: 667, height: 2000 });
    expect(fitWithin(300, 100, 2000)).toEqual({ width: 300, height: 100 });
    expect(fitWithin(10_000, 1, 2000)).toEqual({ width: 2000, height: 1 });
  });
});

describe('pixels through a canvas', () => {
  it('paints, reads back and encodes PNG', async () => {
    const canvas = document.createElement('canvas');
    const pixels = inkOnWhite(6, 4, { x: 1, y: 1, w: 2, h: 2 });
    paintPixels(canvas, pixels);
    const read = readCanvas(canvas);
    expect([read.width, read.height]).toEqual([6, 4]);
    expect([...read.data]).toEqual([...pixels.data]);
    paintPixels(canvas, { data: new Uint8ClampedArray(0), width: 0, height: 0 });
    expect(canvas.width).toBe(0);
    const png = await encodePng(pixels);
    expect(png.type).toBe('image/png');
  });

  it('removes the background and trims to the ink plus padding', async () => {
    const pixels = inkOnWhite(60, 40, { x: 20, y: 10, w: 10, h: 5 });
    const cleaned = withoutBackground(pixels, 235);
    expect(pixels.data[3]).toBe(255); // the input is not changed
    expect(cleaned.data[3]).toBe(0);
    const trimmed = await trimAndEncode(cleaned, 8);
    expect(trimmed).toMatchObject({ width: 26, height: 21 });
    expect(
      await trimAndEncode(withoutBackground(inkOnWhite(4, 4, { x: 0, y: 0, w: 0, h: 0 }), 235), 8),
    ).toBeNull();
  });

  it('rejects when the browser cannot encode', async () => {
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(null));
    await expect(encodePng(inkOnWhite(2, 2, { x: 0, y: 0, w: 1, h: 1 }))).rejects.toThrow('PNG');
    toBlob.mockRestore();
  });

  it('fails loudly without a 2D context', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => readCanvas(document.createElement('canvas'))).toThrow('2D canvas');
    getContext.mockRestore();
  });
});

describe('decodeUpload', () => {
  it('refuses files over the size limit before decoding', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const big = new Blob([new Uint8Array(LIMITS.maxSignatureUploadBytes + 1)]);
    expect(await decodeUpload(big)).toEqual({
      ok: false,
      problems: [{ code: 'signature.too-large', data: { limitMb: 20 } }],
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it('reports images the browser cannot decode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('createImageBitmap', () =>
      Promise.reject(new DOMException('bad', 'InvalidStateError')),
    );
    expect(await decodeUpload(new Blob(['not an image']))).toEqual({
      ok: false,
      problems: [{ code: 'signature.decode-failed' }],
    });
    warn.mockRestore();
  });

  it('decodes with EXIF orientation, caps the long edge and makes a small preview', async () => {
    // jsdom's canvas draws other canvases, which stand in for the decoded bitmap here.
    const source = document.createElement('canvas');
    paintPixels(source, inkOnWhite(3000, 600, { x: 100, y: 100, w: 2800, h: 400 }));
    const close = vi.fn();
    const decode = vi.fn(() => Promise.resolve(Object.assign(source, { close })));
    vi.stubGlobal('createImageBitmap', decode);
    const result = await decodeUpload(new Blob(['x'], { type: 'image/jpeg' }));
    expect(decode).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' });
    expect(close).toHaveBeenCalled();
    if (!result.ok) throw new Error('decode failed');
    expect(result.value.full).toMatchObject({ width: LIMITS.maxSignatureEdge, height: 400 });
    expect(result.value.preview).toMatchObject({ width: PREVIEW_EDGE, height: 128 });
  });
});
