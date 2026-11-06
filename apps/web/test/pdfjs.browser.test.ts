// The pdf.js loader in real browsers (spec §10.3): loading, password handling, page geometry with
// /Rotate, canvas sizes, and which annotations reach the canvas on AcroForm pages.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { load } from '../src/pdfjs/loader.ts';
import { DOCUMENT_OPTIONS } from '../src/pdfjs/options.ts';
import { RenderCancelled, type PdfDisplayDocument } from '../src/pdfjs/types.ts';
import { fixtureBytes } from './pdfFixtures.ts';

async function open(path: string, password?: string): Promise<PdfDisplayDocument> {
  const result = await load(await fixtureBytes(path), password);
  if (!result.ok) throw new Error(`${path}: ${result.problems[0]!.code}`);
  return result.value;
}

async function draw(
  display: PdfDisplayDocument,
  index: number,
  zoom: number,
  annotations: 'all' | 'without-form-widgets' = 'all',
) {
  const page = await display.page(index);
  const canvas = document.createElement('canvas');
  const pixelWidth = Math.round(page.size.width * zoom * 2);
  const pixelHeight = Math.round(page.size.height * zoom * 2);
  await page.render(canvas, { zoom, pixelWidth, pixelHeight, annotations }).promise;
  return canvas;
}

/** Non-white pixels inside a rectangle given in canvas pixels. */
function ink(canvas: HTMLCanvasElement, [x0, y0, x1, y1]: number[]) {
  const { data } = canvas
    .getContext('2d')!
    .getImageData(x0!, y0!, Math.max(1, x1! - x0!), Math.max(1, y1! - y0!));
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! < 230 || data[i + 1]! < 230 || data[i + 2]! < 230) count++;
  }
  return count;
}

describe('loading', () => {
  it('loads a document and reports its pages', async () => {
    const display = await open('vendored/generated/multipage-rotations.pdf');
    expect(display.pageCount).toBe(4);
    const [upright, quarter] = await Promise.all([display.page(0), display.page(1)]);
    expect(upright.index).toBe(0);
    // /Rotate 90 swaps the displayed width and height (V5).
    expect(quarter.size.width).toBeCloseTo(upright.size.height, 6);
    expect(quarter.size.height).toBeCloseTo(upright.size.width, 6);
    // 100% is physical size: 4/3 CSS px per point (spec §5.1).
    expect(upright.size.width % (4 / 3)).toBeCloseTo(0, 6);
    expect(await display.page(1)).toBe(quarter);
    await display.destroy();
  });

  it('asks for a password, rejects a wrong one, and accepts the right one (D3)', async () => {
    const bytes = await fixtureBytes('vendored/generated/acroform-all-aes256.pdf');
    const none = await load(bytes);
    expect(none.ok || none.problems[0]!.code).toBe('pdf.password-required');
    const wrong = await load(bytes, 'nope');
    expect(wrong.ok || wrong.problems[0]!.code).toBe('pdf.password-wrong');
    const right = await load(bytes, 'bogey');
    expect(right.ok).toBe(true);
    // pdf.js transfers what it is given; the caller's bytes stay usable.
    expect(bytes.byteLength).toBeGreaterThan(0);
    if (right.ok) await right.value.destroy();
  });

  it('reports a damaged file', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nnot really a PDF\n%%EOF');
    const result = await load(bytes);
    expect(result.ok || result.problems[0]!.code).toBe('pdf.damaged');
  });
});

describe('rendering', () => {
  it('fills the requested backing store at every rotation', async () => {
    const display = await open('vendored/generated/multipage-rotations.pdf');
    for (const index of [0, 1, 2, 3]) {
      const page = await display.page(index);
      const canvas = await draw(display, index, 1);
      expect(canvas.width).toBe(Math.round(page.size.width * 2));
      expect(canvas.height).toBe(Math.round(page.size.height * 2));
      expect(ink(canvas, [0, 0, canvas.width, canvas.height])).toBeGreaterThan(0);
    }
    await display.destroy();
  });

  it('can be cancelled', async () => {
    const display = await open('vendored/generated/large-20p.pdf');
    const page = await display.page(0);
    const job = page.render(document.createElement('canvas'), {
      zoom: 2,
      pixelWidth: 2000,
      pixelHeight: 2600,
      annotations: 'all',
    });
    job.cancel();
    await expect(job.promise).rejects.toBeDefined();
    expect(RenderCancelled.name).toBe('RenderCancelled');
    display.releaseFar(10, 5);
    await display.destroy();
  });

  it('leaves form widgets out on AcroForm pages, except push buttons (spec §10.3)', async () => {
    const path = 'vendored/generated/acroform-all.pdf';
    const display = await open(path);
    const zoom = 1;
    const withWidgets = await draw(display, 0, zoom, 'all');
    const withoutWidgets = await draw(display, 0, zoom, 'without-form-widgets');

    // Widget rectangles from pdf.js itself, in canvas pixels, read through a separate worker.
    GlobalWorkerOptions.workerPort ??= new Worker(
      new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
      { type: 'module' },
    );
    const reference = await getDocument({ ...DOCUMENT_OPTIONS, data: await fixtureBytes(path) })
      .promise;
    const page = await reference.getPage(1);
    const viewport = page.getViewport({ scale: zoom * (96 / 72) * 2 });
    const widgets = (await page.getAnnotations()) as {
      fieldName: string;
      rect: number[];
      pushButton?: boolean;
    }[];
    const rectOf = (name: string) => {
      const widget = widgets.find((candidate) => candidate.fieldName === name)!;
      const [x0, y0] = viewport.convertToViewportPoint(widget.rect[0]!, widget.rect[1]!);
      const [x1, y1] = viewport.convertToViewportPoint(widget.rect[2]!, widget.rect[3]!);
      return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)].map(
        Math.round,
      );
    };

    for (const name of ['text1', 'check1', 'radio1', 'dropdown1', 'list1', 'readonly1']) {
      expect(ink(withWidgets, rectOf(name)), name).toBeGreaterThan(0);
      expect(ink(withoutWidgets, rectOf(name)), name).toBe(0);
    }
    const button = rectOf('button1');
    expect(ink(withoutWidgets, button)).toBeGreaterThan(ink(withWidgets, button) * 0.8);
    await display.destroy();
  });
});
