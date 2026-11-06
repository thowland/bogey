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
 * Every test fails on a CSP or Trusted Types violation or an uncaught page error (spec §11.3).
 * Violations are collected both from `securitypolicyviolation` events and from console reports.
 */
export const test = base.extend<{ violations: string[] }>({
  violations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(
            `[securitypolicyviolation] ${event.violatedDirective} ${event.blockedURI} ${event.sample}`,
          );
        });
      });
      page.on('console', (message) => {
        const text = message.text();
        if (
          message.type() === 'error' &&
          /securitypolicyviolation|Content Security Policy|Trusted ?Type|TrustedScript|TrustedHTML/i.test(
            text,
          )
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
