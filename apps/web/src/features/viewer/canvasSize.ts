// Canvas backing-store size (V1, spec §10.3): CSS size × devicePixelRatio, so text is sharp on
// Retina and iPad screens, capped so one canvas never exceeds iOS Safari's per-canvas pixel limit.
// Above the cap the canvas renders at the cap and CSS scales it up.

export interface PixelSize {
  width: number;
  height: number;
}

export function canvasSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxPixels: number,
): PixelSize {
  const ratio = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  let width = cssWidth * ratio;
  let height = cssHeight * ratio;
  if (width * height > maxPixels) {
    const shrink = Math.sqrt(maxPixels / (width * height));
    width *= shrink;
    height *= shrink;
  }
  return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
}

/** Frees a canvas's backing store; WebKit releases it reliably only this way (spec §10.3). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
