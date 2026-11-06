// PDF core in a real browser (spec §14.1, §14.4, X5): the pdf worker through comlink, and the X5
// visual check. Each registration-mark fixture is exported with a red square placed where a click
// on the mark (as displayed) would put it; pdf.js renders the export at 4× and the pixels at the
// mark must be red, and the pixels a few points away must not be.
import type { Overlay, PageGeometry } from '@bogey/core';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { createPdfWorkerBridge, pdfBridge, spawnPdfWorker } from '../src/core-bridge/pdf.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

const read = async (path: string) =>
  Uint8Array.from(
    atob(await commands.readFile(`../../fixtures/vendored/generated/${path}`, 'base64')),
    (c) => c.charCodeAt(0),
  );

/** A 4 × 4 opaque red PNG, made by the browser. */
async function redPng(): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(4, 4);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 4, 4);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

// What the overlay layer does on a click at the mark: screen point → PDF point (spec §7.2), then
// an anchor so the square is centred on the click in the upright frame (spec §5.3).
const ZOOM = 1.5;
const SIDE = 8;
function squareAt(page: PageGeometry, mark: { x: number; y: number }, id: string): Overlay {
  const k = ZOOM * (96 / 72);
  const [vx0, vy0, vx1, vy1] = page.view;
  const screen = {
    0: { x: (mark.x - vx0) * k, y: (vy1 - mark.y) * k },
    90: { x: (mark.y - vy0) * k, y: (mark.x - vx0) * k },
    180: { x: (vx1 - mark.x) * k, y: (mark.y - vy0) * k },
    270: { x: (vy1 - mark.y) * k, y: (vx1 - mark.x) * k },
  }[page.rotate];
  // Back to PDF space (spec §5.2), and half the side left and down in the upright frame.
  const back = {
    0: { x: vx0 + screen.x / k, y: vy1 - screen.y / k },
    90: { x: vx0 + screen.y / k, y: vy0 + screen.x / k },
    180: { x: vx1 - screen.x / k, y: vy0 + screen.y / k },
    270: { x: vx1 - screen.y / k, y: vy1 - screen.x / k },
  }[page.rotate];
  const r = (page.rotate * Math.PI) / 180;
  const h = SIDE / 2;
  const x = back.x - h * Math.cos(r) + h * Math.sin(r);
  const y = back.y - h * Math.sin(r) - h * Math.cos(r);
  return {
    id,
    type: 'signature',
    page: page.index,
    x,
    y,
    width: SIDE,
    height: SIDE,
    signatureId: 'red',
  };
}

const FIXTURES: [string, { page: number; x: number; y: number }[]][] = [
  [
    'rotate-0.pdf',
    [
      { page: 0, x: 100, y: 100 },
      { page: 0, x: 306, y: 396 },
      { page: 0, x: 500, y: 700 },
    ],
  ],
  [
    'rotate-90.pdf',
    [
      { page: 0, x: 100, y: 100 },
      { page: 0, x: 500, y: 700 },
    ],
  ],
  [
    'rotate-180.pdf',
    [
      { page: 0, x: 100, y: 100 },
      { page: 0, x: 500, y: 700 },
    ],
  ],
  [
    'rotate-270.pdf',
    [
      { page: 0, x: 100, y: 100 },
      { page: 0, x: 500, y: 700 },
    ],
  ],
  [
    'cropbox-offset.pdf',
    [
      { page: 0, x: 150, y: 180 },
      { page: 0, x: 550, y: 780 },
    ],
  ],
  [
    'cropbox-offset-rotate-90.pdf',
    [
      { page: 0, x: 150, y: 180 },
      { page: 0, x: 550, y: 780 },
    ],
  ],
  [
    'multipage-rotations.pdf',
    [0, 1, 2, 3].flatMap((page) => [
      { page, x: 100, y: 100 },
      { page, x: 500, y: 700 },
    ]),
  ],
];

let png: Uint8Array;
beforeAll(async () => {
  png = await redPng();
});

describe('pdf worker', () => {
  it('inspects and exports through the real worker', async () => {
    const bridge = createPdfWorkerBridge(spawnPdfWorker);
    const bytes = await read('acroform-all.pdf');
    const info = await bridge.inspect(bytes);
    if (!info.ok) throw new Error(JSON.stringify(info.problems));
    expect(info.value.fields).toHaveLength(9);
    expect(bytes.byteLength).toBeGreaterThan(0);
    const stages: string[] = [];
    const out = await bridge.exportPdf(
      {
        bytes,
        info: info.value,
        state: { fieldValues: { text1: 'From the worker' }, overlays: [] },
        signatures: new Map(),
        options: { replaceNonWinAnsi: false, now: 0 },
      },
      (s) => stages.push(s),
    );
    expect(out.ok).toBe(true);
    // Stage callbacks travel on their own comlink channel, so the last may land after the result.
    await vi.waitFor(() =>
      expect(stages).toEqual(['loading', 'fields', 'drawing', 'saving', 'checking']),
    );
    bridge.dispose();
    expect(pdfBridge()).not.toBeNull();
  });
});

describe('X5: overlays land on the registration marks', () => {
  for (const [name, marks] of FIXTURES) {
    it(`exports ${name} with overlays on its marks`, async () => {
      const bytes = await read(name);
      const bridge = createPdfWorkerBridge(spawnPdfWorker);
      const info = await bridge.inspect(bytes);
      if (!info.ok) throw new Error('inspect');
      const overlays = marks.map((m, i) => squareAt(info.value.pages[m.page]!, m, `m${i}`));
      const out = await bridge.exportPdf({
        bytes,
        info: info.value,
        state: { fieldValues: {}, overlays },
        signatures: new Map([['red', { png, width: 4, height: 4 }]]),
        options: { replaceNonWinAnsi: false, now: 0 },
      });
      bridge.dispose();
      if (!out.ok) throw new Error(JSON.stringify(out.problems));

      const task = getDocument({ data: out.value.bytes.slice() });
      const pdf = await task.promise;
      for (const pageIndex of new Set(marks.map((m) => m.page))) {
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 4 });
        const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d')!;
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const pixel = (x: number, y: number) => {
          const [u, v] = viewport.convertToViewportPoint(x, y) as [number, number];
          const d = ctx.getImageData(Math.floor(u), Math.floor(v), 1, 1).data;
          return d[0]! > 200 && d[1]! < 60 && d[2]! < 60;
        };
        for (const m of marks.filter((mark) => mark.page === pageIndex)) {
          // Inside the 8 pt square: the centre and 2.5 pt either way on both axes.
          for (const [dx, dy] of [
            [0, 0],
            [2.5, 0],
            [-2.5, 0],
            [0, 2.5],
            [0, -2.5],
          ] as const) {
            expect(pixel(m.x + dx, m.y + dy), `${name} ${m.x},${m.y} +${dx},${dy}`).toBe(true);
          }
          // Outside: 6 pt away, so a placement error over about 1.5 pt fails.
          for (const [dx, dy] of [
            [6, 0],
            [-6, 0],
            [0, 6],
            [0, -6],
          ] as const) {
            expect(pixel(m.x + dx, m.y + dy), `${name} outside +${dx},${dy}`).toBe(false);
          }
        }
      }
      await task.destroy();
    });
  }
});
