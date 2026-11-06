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
