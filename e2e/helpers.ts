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

/** Merges `patch` into a saved record, as an edit made in an earlier session would have. */
export function patchRecord(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    async ({ id, patch }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('bogey');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('open failed'));
      });
      try {
        const tx = db.transaction('documents', 'readwrite');
        const store = tx.objectStore('documents');
        const read = store.get(id);
        read.onsuccess = () => store.put({ ...(read.result as object), ...patch });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('write failed'));
        });
      } finally {
        db.close();
      }
    },
    { id, patch },
  );
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
 * Seals `edits` into a saved password-protected record, as an earlier session would have (spec
 * §10.5 sealing): PBKDF2-SHA-256 with 600,000 iterations over the record's salt, AES-GCM with the
 * document id as additional data. Used until the overlay and field UI can make real edits.
 */
export function sealRecordEdits(
  page: Page,
  id: string,
  password: string,
  edits: { fieldValues: Record<string, unknown>; overlays: unknown[] },
): Promise<void> {
  return page.evaluate(
    async ({ id, password, edits }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('bogey');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('open failed'));
      });
      try {
        const read = <T>(request: IDBRequest<T>) =>
          new Promise<T>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('request failed'));
          });
        const record = (await read(
          db.transaction('documents').objectStore('documents').get(id),
        )) as { sealed: { salt: ArrayBuffer } };
        const encoder = new TextEncoder();
        const material = await crypto.subtle.importKey(
          'raw',
          encoder.encode(password),
          'PBKDF2',
          false,
          ['deriveKey'],
        );
        const key = await crypto.subtle.deriveKey(
          { name: 'PBKDF2', hash: 'SHA-256', salt: record.sealed.salt, iterations: 600_000 },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt'],
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: encoder.encode(id) },
          key,
          encoder.encode(JSON.stringify(edits)),
        );
        const sealed = { v: 1, salt: record.sealed.salt, iv: iv.buffer, data };
        await read(
          db
            .transaction('documents', 'readwrite')
            .objectStore('documents')
            .put({ ...record, sealed }),
        );
      } finally {
        db.close();
      }
    },
    { id, password, edits },
  );
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
