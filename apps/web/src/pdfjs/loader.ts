// The pdf.js loader (spec §6.1 step 5, §10.3): the one module that imports pdfjs-dist. It is
// loaded on demand by pdfjs/index.ts, so pdf.js is not part of the start-up bundle.
import type { Problem, Result } from '@bogey/core';
import {
  AnnotationMode,
  getDocument,
  PasswordResponses,
  PDFWorker,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import { DOCUMENT_OPTIONS } from './options.ts';
import type { PdfDisplayDocument, PdfPage, RenderJob, RenderOptions } from './types.ts';

/** pdf.js's CSS-px-per-point factor: zoom 1 is physical size (spec §5.1). */
const PDF_TO_CSS = 96 / 72;

let shared: PDFWorker | null = null;

/**
 * The pdf.js worker, started once on first use (spec §10.3). It is a hashed same-origin module
 * that the Trusted Types default policy admits by name (security/trustedTypes.ts).
 *
 * The port is wrapped in one long-lived PDFWorker that every `getDocument` call receives. Setting
 * `GlobalWorkerOptions.workerPort` instead would let pdf.js destroy the shared PDFWorker whenever
 * any one document is destroyed, cutting off the document still on screen
 * (docs/spikes/S1-pdfjs.md).
 */
function pdfWorker(): PDFWorker {
  if (!shared || shared.destroyed) {
    const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {
      type: 'module',
    });
    // pdf.js declares `port` as null, though it takes a Worker (its documented use).
    shared = new PDFWorker({ port: port as unknown as null });
  }
  return shared;
}

/** Maps a pdf.js loading failure to a problem; errors arrive from the worker as plain objects. */
export function loadProblem(error: unknown): Problem {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  if (name === 'PasswordException') {
    return {
      code:
        code === PasswordResponses.INCORRECT_PASSWORD
          ? 'pdf.password-wrong'
          : 'pdf.password-required',
    };
  }
  return { code: 'pdf.damaged' };
}

type OwnCanvases = Map<string, HTMLCanvasElement | HTMLCanvasElement[]>;
type Matrix = [number, number, number, number, number, number];

/**
 * With ENABLE_FORMS, pdf.js draws every widget that has its own canvas (checkboxes, radio buttons,
 * push buttons, read-only text) into `annotationCanvasMap` rather than onto the page. Bogey draws
 * its own checkbox, radio and read-only controls, but a push button gets only an outline (spec
 * §7.1), so its appearance is copied back onto the page here. The own canvas covers the widget's
 * /Rect with its first row at the top edge, so drawing it into the rect in PDF space places it
 * correctly at any page rotation.
 */
async function restorePushButtons(
  proxy: PDFPageProxy,
  canvas: HTMLCanvasElement,
  pageToDevice: Matrix,
  own: OwnCanvases,
): Promise<void> {
  const context = canvas.getContext('2d');
  const annotations = (await proxy.getAnnotations({ intent: 'display' })) as {
    id: string;
    pushButton?: boolean;
    rect: number[];
  }[];
  for (const annotation of annotations) {
    const button = own.get(annotation.id);
    if (!context || !annotation.pushButton || !(button instanceof HTMLCanvasElement)) continue;
    const [x0, y0, x1, y1] = annotation.rect as [number, number, number, number];
    context.save();
    context.setTransform(...pageToDevice);
    context.transform(1, 0, 0, -1, x0, y1);
    context.drawImage(button, 0, 0, x1 - x0, y1 - y0);
    context.restore();
  }
  for (const value of own.values()) {
    for (const ownCanvas of Array.isArray(value) ? value : [value]) {
      ownCanvas.width = 0;
      ownCanvas.height = 0;
    }
  }
}

const multiply = (a: readonly number[], b: readonly number[]): Matrix => [
  a[0]! * b[0]! + a[2]! * b[1]!,
  a[1]! * b[0]! + a[3]! * b[1]!,
  a[0]! * b[2]! + a[2]! * b[3]!,
  a[1]! * b[2]! + a[3]! * b[3]!,
  a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
  a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
];

function renderPage(
  proxy: PDFPageProxy,
  canvas: HTMLCanvasElement,
  options: RenderOptions,
): RenderJob {
  const viewport = proxy.getViewport({ scale: options.zoom * PDF_TO_CSS });
  canvas.width = options.pixelWidth;
  canvas.height = options.pixelHeight;
  // Stretches the CSS-px viewport onto the device-pixel backing store (spec §10.3).
  const toDevice: Matrix = [
    options.pixelWidth / viewport.width,
    0,
    0,
    options.pixelHeight / viewport.height,
    0,
    0,
  ];
  const withoutWidgets = options.annotations === 'without-form-widgets';
  const own: OwnCanvases = new Map();
  const task = proxy.render({
    canvas,
    viewport,
    transform: toDevice,
    annotationMode: withoutWidgets ? AnnotationMode.ENABLE_FORMS : AnnotationMode.ENABLE,
    // Without a map, pdf.js paints both the on and off appearance of every checkbox and radio
    // button onto the page (docs/spikes/S1-pdfjs.md).
    // The declared type omits the arrays pdf.js stores for checkbox and radio states.
    ...(withoutWidgets ? { annotationCanvasMap: own as Map<string, HTMLCanvasElement> } : {}),
  });
  const promise = task.promise.then(() =>
    withoutWidgets
      ? restorePushButtons(proxy, canvas, multiply(toDevice, viewport.transform), own)
      : undefined,
  );
  return { promise, cancel: () => task.cancel() };
}

function wrapPage(proxy: PDFPageProxy, index: number): PdfPage {
  const viewport = proxy.getViewport({ scale: PDF_TO_CSS });
  return {
    index,
    size: { width: viewport.width, height: viewport.height },
    render: (canvas, options) => renderPage(proxy, canvas, options),
  };
}

function wrapDocument(proxy: PDFDocumentProxy, task: PDFDocumentLoadingTask): PdfDisplayDocument {
  const pages = new Map<number, Promise<{ proxy: PDFPageProxy; page: PdfPage }>>();
  return {
    pageCount: proxy.numPages,
    page(index) {
      let entry = pages.get(index);
      if (!entry) {
        entry = proxy
          .getPage(index + 1)
          .then((page) => ({ proxy: page, page: wrapPage(page, index) }));
        pages.set(index, entry);
      }
      return entry.then(({ page }) => page);
    },
    releaseFar(center, distance) {
      for (const [index, entry] of pages) {
        if (Math.abs(index - center) <= distance) continue;
        pages.delete(index);
        // cleanup() defers itself while a render on that page is still running.
        void entry.then(({ proxy: page }) => page.cleanup()).catch(() => undefined);
      }
    },
    // Destroying the loading task frees the document in the worker; the worker itself stays.
    destroy: () => task.destroy(),
  };
}

/** Loads a copy of the bytes for display (spec §6.1 step 5). */
export async function load(
  bytes: Uint8Array,
  password?: string,
): Promise<Result<PdfDisplayDocument, Problem>> {
  const task = getDocument({
    ...DOCUMENT_OPTIONS,
    worker: pdfWorker(),
    data: bytes.slice(),
    ...(password === undefined ? {} : { password }),
  });
  try {
    return { ok: true, value: wrapDocument(await task.promise, task) };
  } catch (error) {
    const problem = loadProblem(error);
    if (problem.code === 'pdf.damaged') console.error('pdf.js could not load the document', error);
    await task.destroy().catch(() => undefined);
    return { ok: false, problems: [problem] };
  }
}
