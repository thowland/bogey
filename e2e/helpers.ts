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
import type { FieldValue } from '../packages/core/src/index.ts';

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

/**
 * Interim export check until the export dialog (Sprint 4) is on master: exports a fixture with the
 * given field values through core, as the pdf worker does, and returns the bytes.
 */
export async function exportInNode(
  path: string,
  fieldValues: Record<string, FieldValue>,
): Promise<Uint8Array> {
  const core = await import('../packages/core/src/index.ts');
  const bytes = new Uint8Array(fixture(path));
  const info = await core.inspectPdf(bytes);
  if (!info.ok) throw new Error(`inspect failed: ${JSON.stringify(info.problems)}`);
  const out = await core.exportPdf({
    bytes,
    info: info.value,
    state: { fieldValues, overlays: [] },
    signatures: new Map(),
    options: { replaceNonWinAnsi: false, now: Date.now() },
  });
  if (!out.ok) throw new Error(`export failed: ${JSON.stringify(out.problems)}`);
  return out.value.bytes;
}

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
