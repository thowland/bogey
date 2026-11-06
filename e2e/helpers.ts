// Shared end-to-end helpers. Append-only per feature section during concurrent waves
// (implementation plan §1.4).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));

/** A fixture file's bytes, by path relative to fixtures/. */
export function fixture(path: string): Buffer {
  return readFileSync(`${root}fixtures/${path}`);
}

/**
 * WebKit's own shadow tree for a native <select> reports a `style-src-attr` violation whenever
 * the element is created, targeted at the SELECT element. Nothing in the page caused it and the
 * control works, so that one report is ignored, in WebKit only (spec §16.4; native controls were
 * chosen on 2026-11-06). WebKit's accompanying console line carries no detail, so it is ignored
 * in WebKit too; the event still records every real violation. A style attribute the page sets on
 * any other element is still caught, which the self-test in security.spec.ts proves. Setting an
 * inline style on a <select> itself would slip through, which Bogey never does: React styles
 * through the CSSOM, and HTML sinks are banned by lint and Trusted Types.
 */
export function isWebKitSelectArtifact(browserName: string, report: string): boolean {
  if (browserName !== 'webkit') return false;
  return (
    report === '[securitypolicyviolation] style-src-attr inline  target=SELECT' ||
    /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/.test(
      report,
    )
  );
}

/**
 * Every test fails on a CSP or Trusted Types violation or an uncaught page error (spec §11.3).
 * Violations are collected both from `securitypolicyviolation` events and from console reports.
 */
export const test = base.extend<{ violations: string[] }>({
  violations: [
    async ({ page, browserName }, use) => {
      const violations: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(
            `[securitypolicyviolation] ${event.violatedDirective} ${event.blockedURI} ${event.sample} target=${(event.target as Element | null)?.nodeName ?? ''}`,
          );
        });
      });
      page.on('console', (message) => {
        const text = message.text();
        if (
          message.type() === 'error' &&
          /securitypolicyviolation|Content Security Policy|Trusted ?Type|TrustedScript|TrustedHTML/i.test(
            text,
          ) &&
          !isWebKitSelectArtifact(browserName, text)
        ) {
          violations.push(text);
        }
      });
      page.on('pageerror', (error) => violations.push(`pageerror: ${error.message}`));
      page.on('crash', () => violations.push('page crashed'));
      await use(violations);
      expect(violations, 'CSP / Trusted Types violations or page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// ── shell (Sprint 0) ──

// ── viewer (Sprint 1) ──
import type { Page } from '@playwright/test';

/** Opens a fixture through the toolbar's file picker and, if given, answers the password dialog. */
export async function openFixture(page: Page, path: string, password?: string): Promise<void> {
  await page.getByTestId('open-input').setInputFiles({
    name: path.split('/').pop()!,
    mimeType: 'application/pdf',
    buffer: fixture(path),
  });
  if (password !== undefined) {
    const dialog = page.getByRole('dialog', { name: 'Password required' });
    await dialog.getByLabel('Password').fill(password);
    await dialog.getByRole('button', { name: 'Open' }).click();
  }
}

/** Waits until the given 1-based page has been drawn, and returns its canvas's size. */
export async function renderedPage(page: Page, number: number) {
  const sheet = page.locator(`[data-page="${number}"][data-status="ready"]`);
  await expect(sheet).toBeVisible();
  return sheet.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
    cssWidth: canvas.getBoundingClientRect().width,
    cssHeight: canvas.getBoundingClientRect().height,
  }));
}

/** The share of sampled canvas pixels that are not white: a blank render scores 0. */
export async function inkCoverage(page: Page, number: number): Promise<number> {
  return page
    .locator(`[data-page="${number}"][data-status="ready"] canvas`)
    .evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let inked = 0;
      let sampled = 0;
      for (let i = 0; i < data.length; i += 4 * 97) {
        sampled++;
        if (data[i]! < 240 || data[i + 1]! < 240 || data[i + 2]! < 240) inked++;
      }
      return inked / sampled;
    });
}

// ── fields (Sprint 5) ──

/** The field layer of the page on screen (F2). */
export function fieldLayer(page: Page) {
  return page.getByRole('group', { name: /^Form fields on page \d+$/ });
}

/** The Fields panel (F7), opened on its tab. */
export async function fieldsPanel(page: Page) {
  const panel = page.getByRole('complementary', { name: /fields, snippets and signatures/i });
  await panel.getByRole('tab', { name: 'Fields' }).click();
  return panel;
}

import { createRequire } from 'node:module';

/** The part of pdf-lib the export check uses, loaded from core's own dependency. */
interface PdfLibSubset {
  PDFDocument: {
    load(bytes: Uint8Array): Promise<{
      getForm(): { getFields(): unknown[] };
      context: { enumerateIndirectObjects(): [unknown, unknown][] };
    }>;
  };
  PDFRawStream: abstract new (...args: never[]) => object;
  decodePDFRawStream(stream: object): { decode(): Uint8Array };
}

const corePdfLib = createRequire(new URL('../packages/core/package.json', import.meta.url))(
  '@cantoo/pdf-lib',
) as PdfLibSubset;

/** A flattened export: how many form fields remain, and every decoded content stream as text. */
export async function readFlattened(bytes: Uint8Array) {
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = corePdfLib;
  const doc = await PDFDocument.load(bytes);
  const fields = doc.getForm().getFields().length;
  let streams = '';
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      streams += Buffer.from(decodePDFRawStream(object).decode()).toString('latin1');
    }
  }
  /** Whether `text` is drawn, as a literal or a hex string (pdf-lib writes WinAnsi hex). */
  const draws = (text: string) =>
    streams.includes(`(${text})`) ||
    streams
      .toUpperCase()
      .includes(`<${Buffer.from(text, 'latin1').toString('hex').toUpperCase()}>`);
  return { fields, draws };
}

/** The share of non-white pixels in a PDF-point box of a rendered page (0 for blank paper). */
export async function inkInBox(
  page: Page,
  number: number,
  box: [x0: number, y0: number, x1: number, y1: number],
  pageHeightPt: number,
): Promise<number> {
  return page.locator(`[data-page="${number}"][data-status="ready"] canvas`).evaluate(
    (canvas: HTMLCanvasElement, { box, pageHeightPt }) => {
      const k = canvas.height / pageHeightPt;
      const [x0, y0, x1, y1] = box;
      const sx = Math.round(x0 * k);
      const sy = Math.round((pageHeightPt - y1) * k);
      const w = Math.max(1, Math.round((x1 - x0) * k));
      const h = Math.max(1, Math.round((y1 - y0) * k));
      const { data } = canvas.getContext('2d')!.getImageData(sx, sy, w, h);
      let inked = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 200 || data[i + 1]! < 200 || data[i + 2]! < 200) inked++;
      }
      return inked / (data.length / 4);
    },
    { box, pageHeightPt },
  );
}

// ── overlays and export (Sprint 4) ──
import type { Download } from '@playwright/test';
import { PDFDocument } from '../tooling/node_modules/@cantoo/pdf-lib/es/index.js';
import { OPS } from '../apps/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { openWithPdfjs, textItems, type TextItem } from '../tooling/test/pdfCore.ts';

/** The overlay layer of the page shown, which covers the page sheet. */
export async function pageArea(page: Page) {
  const layer = page.getByTestId('overlay-layer');
  await expect(layer).toBeVisible();
  const box = (await layer.boundingBox())!;
  return { layer, box };
}

/**
 * Converts a point on a displayed letter-size page (CSS px from its top-left) to PDF points, for a
 * page whose view box is [0, 0, 612, 792] (spec §5.2).
 */
export function letterPoint(
  box: { width: number },
  rotate: 0 | 90 | 180 | 270,
  px: { x: number; y: number },
) {
  const k = box.width / (rotate % 180 === 0 ? 612 : 792);
  const u = px.x / k;
  const v = px.y / k;
  switch (rotate) {
    case 0:
      return { x: u, y: 792 - v };
    case 90:
      return { x: v, y: u };
    case 180:
      return { x: 612 - u, y: v };
    case 270:
      return { x: 612 - v, y: 792 - u };
  }
}

/** Draws a signature with the mouse in the draw dialog and saves it under `name`. */
export async function drawSignature(page: Page, name: string): Promise<void> {
  const panel = page.getByRole('complementary', { name: /fields, snippets and signatures/i });
  await panel.getByRole('tab', { name: 'Signatures' }).click();
  await panel.getByRole('button', { name: 'Draw' }).click();
  const dialog = page.getByRole('dialog', { name: 'Draw a signature' });
  const pad = dialog.getByRole('img', { name: 'Signature drawing area' });
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height * 0.7);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + 60 + i * 30, box.y + box.height * (0.5 + 0.25 * Math.sin(i)), {
      steps: 2,
    });
  }
  await page.mouse.up();
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
}

/** Starts a download with `start` and returns its suggested name and bytes. */
export async function download(
  page: Page,
  start: () => Promise<void>,
): Promise<{ name: string; bytes: Uint8Array }> {
  const pending: Promise<Download> = page.waitForEvent('download');
  await start();
  const file = await pending;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { name: file.suggestedFilename(), bytes: new Uint8Array(Buffer.concat(chunks)) };
}

export interface ExportCheck {
  pageCount: number;
  fieldCount: number;
  encrypted: boolean;
  producer: string | undefined;
  /** Text items per page, in PDF user space. */
  text: TextItem[][];
  /** Drawn images per page, as their placement matrix [a, b, c, d, e, f]. */
  images: number[][][];
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  n[0] * m[0] + n[1] * m[2],
  n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2],
  n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4],
  n[4] * m[1] + n[5] * m[3] + m[5],
];

/** Reads an export back with pdf-lib and pdf.js, the way spec §14.4 verifies exports. */
export async function readExport(bytes: Uint8Array): Promise<ExportCheck> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const images: number[][][] = [];
  const pdf = await openWithPdfjs(bytes);
  for (let i = 1; i <= pdf.numPages; i++) {
    const ops = await (await pdf.getPage(i)).getOperatorList();
    const found: number[][] = [];
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    ops.fnArray.forEach((fn, j) => {
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = multiply(ctm, ops.argsArray[j] as Matrix);
      else if (fn === OPS.paintImageXObject) found.push([...ctm]);
    });
    images.push(found);
  }
  await pdf.close();
  return {
    pageCount: doc.getPageCount(),
    fieldCount: doc.getForm().getFields().length,
    encrypted: doc.isEncrypted || doc.context.trailerInfo.Encrypt !== undefined,
    producer: doc.getProducer(),
    text: await textItems(bytes),
    images,
  };
}

// ── documents and storage (Sprint 6) ──

/** A saved document record as the page reads it from IndexedDB, without its binary thumbnail. */
export interface SavedRecord {
  id: string;
  name: string;
  pageCount: number;
  lastPage: number;
  zoom: number | string;
  updatedAt: number;
  hasThumbnail: boolean;
  fieldValues: Record<string, unknown>;
  overlays: { id: string }[];
}

// Each helper is one self-contained function run in the page: no code is built from strings,
// which the production CSP and Trusted Types would refuse.

/** Every saved document record, most recently updated first. */
export function savedRecords(page: Page): Promise<SavedRecord[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('bogey');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('open failed'));
    });
    try {
      if (!db.objectStoreNames.contains('documents')) return [];
      const all = await new Promise<{ thumbnail: unknown; updatedAt: number }[]>(
        (resolve, reject) => {
          const request = db.transaction('documents').objectStore('documents').getAll();
          request.onsuccess = () =>
            resolve(request.result as { thumbnail: unknown; updatedAt: number }[]);
          request.onerror = () => reject(request.error ?? new Error('read failed'));
        },
      );
      return all
        .map((record) => ({
          ...record,
          thumbnail: undefined,
          hasThumbnail: record.thumbnail !== null,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt) as never;
    } finally {
      db.close();
    }
  });
}

/** The number of stored byte records (one per saved document). */
export function savedByteCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('bogey');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('open failed'));
    });
    try {
      if (!db.objectStoreNames.contains('documentBytes')) return 0;
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction('documentBytes').objectStore('documentBytes').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('count failed'));
      });
    } finally {
      db.close();
    }
  });
}

/** `settings.activeDocumentId`, or null. */
export function activeDocumentId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('bogey');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('open failed'));
    });
    try {
      if (!db.objectStoreNames.contains('settings')) return null;
      const row = await new Promise<{ value: string | null } | undefined>((resolve, reject) => {
        const request = db.transaction('settings').objectStore('settings').get('activeDocumentId');
        request.onsuccess = () => resolve(request.result as { value: string | null } | undefined);
        request.onerror = () => reject(request.error ?? new Error('read failed'));
      });
      return row ? row.value : null;
    } finally {
      db.close();
    }
  });
}

/** Opens the bytes of a fixture under another file name, as a different document. */
export async function openFixtureAs(page: Page, path: string, name: string): Promise<void> {
  await page.getByTestId('open-input').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: fixture(path),
  });
}

/** Waits until the open document has been saved and recorded as the active one. */
export async function waitForSaved(page: Page, name: string): Promise<SavedRecord> {
  let found: SavedRecord | undefined;
  await expect
    .poll(async () => {
      const records = await savedRecords(page);
      found = records.find((record) => record.name === name && record.pageCount > 0);
      return found !== undefined && (await activeDocumentId(page)) === found.id;
    })
    .toBe(true);
  return found!;
}

/**
 * The violation checks of the `test` fixture, for pages the fixture does not create (a persistent
 * context that is closed and reopened). Returns the list that collects them.
 */
export function watchViolations(page: Page, browserName: string): string[] {
  const violations: string[] = [];
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `[securitypolicyviolation] ${event.violatedDirective} ${event.blockedURI} ${event.sample} target=${(event.target as Element | null)?.nodeName ?? ''}`,
      );
    });
  });
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' &&
      /securitypolicyviolation|Content Security Policy|Trusted ?Type|TrustedScript|TrustedHTML/i.test(
        text,
      ) &&
      !isWebKitSelectArtifact(browserName, text)
    ) {
      violations.push(text);
    }
  });
  page.on('pageerror', (error) => violations.push(`pageerror: ${error.message}`));
  return violations;
}

/**
 * A saved record's sealed edits, decrypted with `password` in the page; null if there are none.
 * `text` is everything the record holds, binary fields decoded, for scanning for plaintext.
 */
export function openSealedRecord(
  page: Page,
  id: string,
  password: string,
): Promise<{ edits: unknown; text: string; updatedAt: number }> {
  return page.evaluate(
    async ({ id, password }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('bogey');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('open failed'));
      });
      try {
        const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
          const request = db.transaction('documents').objectStore('documents').get(id);
          request.onsuccess = () => resolve(request.result as Record<string, unknown>);
          request.onerror = () => reject(request.error ?? new Error('read failed'));
        });
        const parts: string[] = [];
        const walk = (node: unknown) => {
          if (node instanceof ArrayBuffer) {
            const bytes = new Uint8Array(node);
            parts.push(new TextDecoder().decode(bytes), String.fromCharCode(...bytes));
          } else if (node && typeof node === 'object') {
            for (const child of Object.values(node)) walk(child);
          } else {
            parts.push(String(node));
          }
        };
        walk(record);
        const text = parts.join('\n');
        const sealed = record.sealed as
          { salt: ArrayBuffer; iv: ArrayBuffer; data: ArrayBuffer } | undefined;
        if (!sealed) return { edits: null, text, updatedAt: record.updatedAt as number };
        const encoder = new TextEncoder();
        const material = await crypto.subtle.importKey(
          'raw',
          encoder.encode(password),
          'PBKDF2',
          false,
          ['deriveKey'],
        );
        const key = await crypto.subtle.deriveKey(
          { name: 'PBKDF2', hash: 'SHA-256', salt: sealed.salt, iterations: 600_000 },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt'],
        );
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: sealed.iv, additionalData: encoder.encode(id) },
          key,
          sealed.data,
        );
        return {
          edits: JSON.parse(new TextDecoder().decode(plain)) as unknown,
          text,
          updatedAt: record.updatedAt as number,
        };
      } finally {
        db.close();
      }
    },
    { id, password },
  );
}

// ── touch and iPad (Sprint 8) ──

/** The page sheet on screen (its neighbors are rendered hidden). */
export function pageSheet(page: Page) {
  return page.locator('[data-page]:not([hidden])');
}

/** The zoom the toolbar shows, for example "150%" or "Fit width". */
export async function zoomLabel(page: Page): Promise<string> {
  const name = await page.getByRole('button', { name: /^Zoom level: / }).getAttribute('aria-label');
  return name!.replace('Zoom level: ', '');
}

/**
 * A WebKit pinch over the element matching `selector`: gesturestart, a gesturechange per scale and
 * a gestureend, dispatched in the page with their fields set the way Safari sets them. Returns
 * whether every event was cancelled, and the page sheet's transform after the next-to-last change.
 */
export function pinchInPage(
  page: Page,
  selector: string,
  scales: number[],
): Promise<{ prevented: boolean; during: string }> {
  return page.evaluate(
    ({ selector, scales }) => {
      const target = document.querySelector(selector)!;
      const box = target.getBoundingClientRect();
      const centre = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      let prevented = true;
      let during = '';
      const send = (type: string, scale: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { scale, ...centre });
        target.dispatchEvent(event);
        prevented &&= event.defaultPrevented;
      };
      send('gesturestart', 1);
      scales.forEach((scale, index) => {
        send('gesturechange', scale);
        if (index === scales.length - 2) {
          during =
            document.querySelector<HTMLElement>('[data-page]:not([hidden])')?.style.transform ?? '';
        }
      });
      send('gestureend', scales[scales.length - 1] ?? 1);
      return { prevented, during };
    },
    { selector, scales },
  );
}

/**
 * A one-finger touch drag on the element matching `selector`, from `from` (CSS px from its
 * top-left) by `dx`, `dy`: touch pointer events dispatched in the page, since Playwright can only
 * tap. Its pointerId is one no real pointer uses.
 */
export function touchDragInPage(
  page: Page,
  selector: string,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  return page.evaluate(
    ({ selector, from, dx, dy }) => {
      const target = document.querySelector(selector)!;
      const box = target.getBoundingClientRect();
      const send = (type: string, step: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 41,
            pointerType: 'touch',
            isPrimary: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: box.left + from.x + dx * step,
            clientY: box.top + from.y + dy * step,
          }),
        );
      send('pointerdown', 0);
      for (const step of [0.25, 0.5, 0.75, 1]) send('pointermove', step);
      send('pointerup', 1);
    },
    { selector, from, dx, dy },
  );
}

// ── snippets and settings (Sprint 7) ──

/** The N1 defaults, in their seeded order. */
const SEEDED_SNIPPETS = [
  'Full name',
  'Address line 1',
  'Address line 2',
  'City/State/ZIP',
  'Phone',
  'Email',
] as const;

/** The Snippets panel, opened on its tab. */
export async function snippetsPanel(page: Page) {
  const panel = page.getByRole('complementary', { name: /fields, snippets and signatures/i });
  await panel.getByRole('tab', { name: 'Snippets' }).click();
  return panel;
}

/** Fills seeded snippets' values through Edit snippets, then returns to the snippet buttons. */
export async function fillSnippets(
  page: Page,
  values: Partial<Record<(typeof SEEDED_SNIPPETS)[number], string>>,
) {
  const panel = await snippetsPanel(page);
  await panel.getByRole('button', { name: 'Edit snippets' }).click();
  for (const [label, value] of Object.entries(values)) {
    const row = panel.getByRole('group', {
      name: `Snippet ${SEEDED_SNIPPETS.indexOf(label as never) + 1}`,
      exact: true,
    });
    await expect(row.getByLabel('Label')).toHaveValue(label);
    await row.getByLabel('Value').fill(value);
  }
  await panel.getByRole('button', { name: 'Done' }).click();
  return panel;
}

/** A snippet button in the panel, by its label (Today included). */
export function snippetButton(panel: ReturnType<Page['getByRole']>, label: string) {
  return panel.getByRole('list', { name: 'Snippets' }).getByRole('button', {
    name: label,
    exact: true,
  });
}

/** Today in a format, from the test machine's clock (the browser shares it). */
export function todayIn(format: 'MM/DD/YYYY' | 'YYYY-MM-DD'): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return format === 'YYYY-MM-DD'
    ? `${now.getFullYear()}-${mm}-${dd}`
    : `${mm}/${dd}/${now.getFullYear()}`;
}
