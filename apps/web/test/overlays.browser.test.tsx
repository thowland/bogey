// Overlays and export in a real browser (spec §7.2, §9.5, §14.5). The text baseline the browser
// draws from Liberation Sans's metrics must sit on the stored anchor, and the exported text,
// read back with pdf.js, must start at the same point, at 10 pt and 36 pt and on rotated pages.
// Page images for undecryptable originals must come out unrotated.
import type { Overlay, PageGeometry, Rotation } from '@bogey/core';
import { render } from '@testing-library/react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { afterEach, describe, expect, it } from 'vitest';
import { pdfBridge } from '../src/core-bridge/pdf.ts';
import { screenToPdf } from '../src/core-bridge/geometry.ts';
import { renderPageImages } from '../src/features/export/pageImages.ts';
import { OverlayLayer } from '../src/features/overlays/index.ts';
import { pdfjsLoader } from '../src/pdfjs/index.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { useViewStore } from '../src/state/view.ts';
import { fixtureBytes } from './pdfFixtures.ts';
import '../src/styles/tokens.css';
import '../src/styles/fonts.css';

GlobalWorkerOptions.workerSrc = workerUrl;

const read = (name: string) => fixtureBytes(`vendored/generated/${name}`);

const ZOOM = 1.5;

/** The first baseline's left end as the browser laid it out, in page-local CSS px. */
function measuredBaseline(sheet: HTMLElement, id: string) {
  const text = sheet.querySelector(`[data-overlay-id="${id}"] span`)!;
  const marker = document.createElement('span');
  marker.style.display = 'inline-block';
  text.prepend(marker);
  const box = sheet.getBoundingClientRect();
  const m = marker.getBoundingClientRect();
  marker.remove();
  return { x: m.left - box.left, y: m.bottom - box.top };
}

afterEach(() => {
  useDocumentStore.getState().reset();
  useEditsStore.getState().reset();
  useViewStore.getState().reset();
});

describe('text placement (acceptance 2)', () => {
  const cases: [string, Rotation][] = [
    ['rotate-0.pdf', 0],
    ['rotate-90.pdf', 90],
    ['rotate-270.pdf', 270],
  ];

  for (const [file, rotate] of cases) {
    it(`matches the export within 1 pt at 10 pt and 36 pt on ${file}`, async () => {
      const bytes = await read(file);
      const inspected = await pdfBridge().inspect(bytes);
      if (!inspected.ok) throw new Error('inspect failed');
      const info = inspected.value;
      const page = info.pages[0]!;
      expect(page.rotate).toBe(rotate);
      const overlays: Overlay[] = [
        {
          id: 'small',
          type: 'text',
          page: 0,
          x: 120,
          y: 500,
          text: 'Small Agj',
          size: 10,
          bold: false,
        },
        {
          id: 'large',
          type: 'text',
          page: 0,
          x: 200,
          y: 300,
          text: 'Large Agj',
          size: 36,
          bold: true,
        },
      ];

      useDocumentStore.getState().update({ status: 'ready', info, bytes });
      useViewStore.getState().setRenderedZoom(ZOOM);
      for (const overlay of overlays)
        useEditsStore.getState().edit({ type: 'addOverlay', overlay });
      const width = (rotate % 180 === 0 ? 612 : 792) * ZOOM * (96 / 72);
      const height = (rotate % 180 === 0 ? 792 : 612) * ZOOM * (96 / 72);
      const { container } = render(
        <div style={{ position: 'relative', width, height }}>
          <OverlayLayer />
        </div>,
      );
      const sheet = container.firstElementChild as HTMLElement;
      await document.fonts.load('36px "Bogey Overlay"');
      await document.fonts.load('bold 36px "Bogey Overlay"');
      await document.fonts.ready;

      const result = await pdfBridge().exportPdf({
        bytes,
        info,
        state: useEditsStore.getState().present,
        signatures: new Map(),
        options: { replaceNonWinAnsi: false, now: 0 },
      });
      if (!result.ok) throw new Error(result.problems[0]!.code);
      const task = getDocument({ data: result.value.bytes });
      const pdf = await task.promise;
      const items = (await (await pdf.getPage(1)).getTextContent()).items as {
        str: string;
        transform: number[];
      }[];

      for (const overlay of overlays) {
        const onScreen = screenToPdf(page, measuredBaseline(sheet, overlay.id), ZOOM);
        const exported = items.find((item) =>
          item.str.startsWith(overlay.id === 'small' ? 'Small' : 'Large'),
        )!;
        const atExport = { x: exported.transform[4]!, y: exported.transform[5]! };
        expect(Math.abs(onScreen.x - atExport.x), `${overlay.id} x`).toBeLessThan(1);
        expect(Math.abs(onScreen.y - atExport.y), `${overlay.id} y`).toBeLessThan(1);
        expect(Math.abs(atExport.x - overlay.x)).toBeLessThan(0.01);
        expect(Math.abs(atExport.y - overlay.y)).toBeLessThan(0.01);
      }
      await task.destroy();
    });
  }
});

describe('page images (spec §9.5)', () => {
  it('renders a rotated page unrotated, at 200 dpi, with the marks in place', async () => {
    const loaded = await pdfjsLoader().load(await read('rotate-90.pdf'));
    if (!loaded.ok) throw new Error('load failed');
    const geometry: PageGeometry = { index: 0, view: [0, 0, 612, 792], rotate: 90, userUnit: 1 };
    const seen: number[] = [];
    const [image] = await renderPageImages(loaded.value, [geometry], (i) => seen.push(i));
    expect(seen).toEqual([0]);
    const bitmap = await createImageBitmap(
      new Blob([image!.jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
    );
    expect([bitmap.width, bitmap.height]).toEqual([1700, 2200]);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    // The registration mark at PDF (100, 100) is drawn where the unrotated page has it.
    const darkest = (x: number, y: number) => {
      const { data } = ctx.getImageData(x - 4, y - 4, 9, 9);
      let min = 255;
      for (let i = 0; i < data.length; i += 4) min = Math.min(min, data[i]!);
      return min;
    };
    const s = 1700 / 612;
    expect(darkest(Math.round(100 * s), Math.round((792 - 100) * s))).toBeLessThan(128);
    expect(darkest(Math.round(160 * s), Math.round((792 - 160) * s))).toBeGreaterThan(200);
    await loaded.value.destroy();
  });
});
