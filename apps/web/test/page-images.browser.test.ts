// The page-image export on rotated pages (spec §9.5; implementation plan §4, the check left for
// Sprint 10). No shipped fixture is undecryptable and rotated, so these tests force
// `decryptable: false` onto rotated fixtures, here in the test only, by both routes the app has:
//
// - "pdf.js accepted the password, core rejected it": the open flow describes each page from
//   pdf.js's displayed size with no rotation (features/storage/undecryptable.ts);
// - "core read it but cannot decrypt every stream": core's own geometry, rotation included.
//
// A text overlay is placed 40 CSS px to the right of a registration mark as the page shows it,
// the export runs through the app's export flow (pdf.js renders each page, core builds the file),
// and the result is rendered again with pdf.js. The mark found in the exported page image and the
// exported text must be as far apart as they were on screen, within 1 pt.
import type { Overlay, PageGeometry, PdfInfo } from '@bogey/core';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { afterEach, describe, expect, it } from 'vitest';
import { pdfToScreen, scaleFor, screenToPdf } from '../src/core-bridge/geometry.ts';
import { pdfBridge } from '../src/core-bridge/pdf.ts';
import { defaultDeps, runExport } from '../src/features/export/exportFlow.ts';
import { pageImageInfo } from '../src/features/storage/undecryptable.ts';
import { pdfjsLoader } from '../src/pdfjs/index.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { fixtureBytes } from './pdfFixtures.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

/** CSS px on screen between the mark and the overlay's anchor. */
const OFFSET_PX = 40;
const ZOOM = 1;

const CASES = [
  { file: 'rotate-90.pdf', mark: { x: 306, y: 396 } },
  { file: 'rotate-180.pdf', mark: { x: 100, y: 100 } },
  { file: 'rotate-270.pdf', mark: { x: 500, y: 700 } },
  { file: 'cropbox-offset-rotate-90.pdf', mark: { x: 356, y: 476 } },
] as const;

afterEach(() => {
  useDocumentStore.getState().reset();
  useEditsStore.getState().reset();
});

/** The centroid of dark pixels within `radius` points of `near`, on the page rendered at `scale`. */
function darkCentroid(
  canvas: HTMLCanvasElement,
  near: { x: number; y: number },
  radius: number,
  scale: number,
): { x: number; y: number } | null {
  const ctx = canvas.getContext('2d')!;
  const x0 = Math.max(0, Math.round((near.x - radius) * scale));
  const y0 = Math.max(0, Math.round((near.y - radius) * scale));
  const size = Math.round(2 * radius * scale);
  const { data, width } = ctx.getImageData(x0, y0, size, size);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! < 110 && data[i + 1]! < 110 && data[i + 2]! < 110) {
      const p = i / 4;
      sx += (p % width) + 0.5;
      sy += Math.floor(p / width) + 0.5;
      n++;
    }
  }
  return n === 0 ? null : { x: (x0 + sx / n) / scale, y: (y0 + sy / n) / scale };
}

for (const route of ['pdf.js geometry', 'core geometry'] as const) {
  describe(`page-image export of rotated pages, ${route}`, () => {
    for (const { file, mark } of CASES) {
      it(`keeps an overlay within 1 pt of where it was on screen, ${file}`, async () => {
        const bytes = await fixtureBytes(`vendored/generated/${file}`);
        const inspected = await pdfBridge().inspect(bytes);
        if (!inspected.ok) throw new Error('inspect failed');
        // Where pdf.js shows the mark: the unrotated mark through the page's true geometry.
        const truth: PageGeometry = inspected.value.pages[0]!;
        expect(truth.rotate).not.toBe(0);
        const markOnScreen = pdfToScreen(truth, mark, ZOOM);

        const loaded = await pdfjsLoader().load(bytes);
        if (!loaded.ok) throw new Error('load failed');
        const display = loaded.value;
        // The test-only part: an undecryptable document, by either route.
        const info: PdfInfo =
          route === 'pdf.js geometry'
            ? await pageImageInfo(display)
            : { ...inspected.value, decryptable: false };
        const page = info.pages[0]!;

        // The overlay a click 40 px right of the mark makes, in the document's own geometry.
        const anchor = screenToPdf(
          page,
          { x: markOnScreen.x + OFFSET_PX, y: markOnScreen.y },
          ZOOM,
        );
        const overlay: Overlay = {
          id: 'o',
          type: 'text',
          page: 0,
          ...anchor,
          text: 'Here',
          size: 10,
          bold: false,
        };
        useDocumentStore
          .getState()
          .update({ status: 'ready', name: file, info, bytes, display, password: null });
        useEditsStore.getState().edit({ type: 'addOverlay', overlay });

        let out: Uint8Array | null = null;
        const stages: string[] = [];
        const result = await runExport({ replaceNonWinAnsi: false }, (s) => stages.push(s), {
          ...defaultDeps(),
          download: (written) => {
            out = written;
          },
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(stages[0]).toBe('rendering');

        // The export as a reader shows it: text position and the mark in the page image.
        const task = getDocument({ data: out! });
        const pdf = await task.promise;
        const exported = await pdf.getPage(1);
        const viewport = exported.getViewport({ scale: 1 });
        const item = (
          (await exported.getTextContent()).items as { str: string; transform: number[] }[]
        ).find((i) => i.str === 'Here')!;
        const [tx, ty] = viewport.convertToViewportPoint(item.transform[4]!, item.transform[5]!);
        const k = scaleFor(page, ZOOM);
        const expectedMark = { x: tx! - OFFSET_PX / k, y: ty! };

        const scale = 4;
        const canvas = document.createElement('canvas');
        const big = exported.getViewport({ scale });
        canvas.width = big.width;
        canvas.height = big.height;
        await exported.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: big })
          .promise;
        const found = darkCentroid(canvas, expectedMark, 7, scale);
        expect(found, 'the mark is near where the overlay says it should be').not.toBeNull();
        expect(Math.abs(found!.x - expectedMark.x), 'x').toBeLessThan(1);
        expect(Math.abs(found!.y - expectedMark.y), 'y').toBeLessThan(1);

        await task.destroy();
        await display.destroy();
      });
    }
  });
}
