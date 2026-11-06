// The display contract between pdf.js and the rest of the app (spec §2, §10.3). Only this
// directory imports pdfjs-dist; everything else works with these interfaces, so components can be
// tested with a fake loader and pdf.js stays a display device.
import type { Problem, Result } from '@bogey/core';

/** CSS px at zoom 1 (100%, physical size), with the page's /Rotate applied (spec §5.1). */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * Which annotations are drawn into the canvas (spec §10.3): everything, or everything except
 * form widgets, which Bogey draws as its own controls on AcroForm documents.
 */
export type AnnotationRendering = 'all' | 'without-form-widgets';

export interface RenderOptions {
  /** 1 is 100% (spec §5.1). */
  zoom: number;
  /** The canvas backing store, in device pixels (see viewer/canvasSize.ts). */
  pixelWidth: number;
  pixelHeight: number;
  annotations: AnnotationRendering;
}

/** A started render: settles when the canvas is drawn; `cancel` stops it. */
export interface RenderJob {
  promise: Promise<void>;
  cancel(): void;
}

export interface PdfPage {
  /** 0-based. */
  readonly index: number;
  readonly size: PageSize;
  render(canvas: HTMLCanvasElement, options: RenderOptions): RenderJob;
}

/** A document loaded into pdf.js for display. */
export interface PdfDisplayDocument {
  readonly pageCount: number;
  page(index: number): Promise<PdfPage>;
  /** Frees pdf.js resources for loaded pages further than `distance` from `center` (spec §10.3). */
  releaseFar(center: number, distance: number): void;
  destroy(): Promise<void>;
}

export interface PdfjsLoader {
  /**
   * Loads a copy of `bytes` (pdf.js transfers what it receives). Fails with
   * `pdf.password-required`, `pdf.password-wrong` or `pdf.damaged`.
   */
  load(bytes: Uint8Array, password?: string): Promise<Result<PdfDisplayDocument, Problem>>;
}

/** A render that was cancelled because its result was no longer wanted. */
export class RenderCancelled extends Error {
  override name = 'RenderCancelled';
}

/** A render that ran past the render timeout (spec §11.4). */
export class RenderTimedOut extends Error {
  override name = 'RenderTimedOut';
}
