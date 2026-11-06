// A fake pdf.js display layer for jsdom tests: documents, pages and renders that settle when the
// test says so.
import { fail, ok, type Problem } from '@bogey/core';
import type {
  PdfDisplayDocument,
  PdfjsLoader,
  PdfPage,
  RenderJob,
  RenderOptions,
} from '../src/pdfjs/types.ts';

export interface FakeRender {
  page: number;
  options: RenderOptions;
  canvas: HTMLCanvasElement;
  resolve(): void;
  reject(error: Error): void;
  cancelled: boolean;
}

export interface FakeDocument extends PdfDisplayDocument {
  renders: FakeRender[];
  released: [number, number][];
  destroyed: boolean;
}

const LETTER = { width: 816, height: 1056 };

export function fakeDocument(
  pageCount: number,
  { autoRender = true, sizes = [] as { width: number; height: number }[] } = {},
): FakeDocument {
  const renders: FakeRender[] = [];
  const pages = new Map<number, PdfPage>();
  const document: FakeDocument = {
    pageCount,
    renders,
    released: [],
    destroyed: false,
    page(index) {
      let page = pages.get(index);
      if (!page) {
        page = {
          index,
          size: sizes[index] ?? LETTER,
          render(canvas, options): RenderJob {
            let render!: FakeRender;
            const promise = new Promise<void>((resolve, reject) => {
              render = { page: index, options, canvas, resolve, reject, cancelled: false };
            });
            renders.push(render);
            if (autoRender) render.resolve();
            return {
              promise,
              cancel: () => {
                render.cancelled = true;
                render.reject(new Error('cancelled by pdf.js'));
              },
            };
          },
        };
        pages.set(index, page);
      }
      return Promise.resolve(page);
    },
    releaseFar(center, distance) {
      document.released.push([center, distance]);
    },
    destroy() {
      document.destroyed = true;
      return Promise.resolve();
    },
  };
  return document;
}

export interface FakeLoader extends PdfjsLoader {
  calls: { bytes: Uint8Array; password: string | undefined }[];
  documents: FakeDocument[];
}

/**
 * A loader that opens documents of `pageCount` pages. With `password`, it behaves like an
 * encrypted file: no password → required, a different one → wrong.
 */
export function fakeLoader({
  pageCount = 3,
  password,
  problem,
}: { pageCount?: number; password?: string; problem?: Problem } = {}): FakeLoader {
  const loader: FakeLoader = {
    calls: [],
    documents: [],
    load(bytes, given) {
      loader.calls.push({ bytes, password: given });
      if (problem) return Promise.resolve(fail(problem));
      if (password !== undefined && given !== password) {
        return Promise.resolve(
          fail({ code: given === undefined ? 'pdf.password-required' : 'pdf.password-wrong' }),
        );
      }
      const document = fakeDocument(pageCount);
      loader.documents.push(document);
      return Promise.resolve(ok(document));
    },
  };
  return loader;
}

/** A File holding a minimal PDF header. */
export const pdfFile = (name = 'form.pdf', body = '%PDF-1.7\n%%EOF') =>
  new File([body], name, { type: 'application/pdf' });
