// Shared helpers for the Sprint 2 fixture tests: the manifest, fixture bytes, and pdf.js (legacy
// build, which runs in Node) for reading exports back as a reader would (spec §14.4).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDocument,
  VerbosityLevel,
} from '../../apps/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));

export interface Entry {
  path: string;
  formType: 'acroform' | 'xfa' | 'flat';
  xfa: 'none' | 'hybrid' | 'dynamic';
  encrypted: boolean;
  password: string | null;
  cipher?: string;
  rotation: number[];
  cropOrigin: boolean;
  pageCount: number;
  fieldKinds?: string[];
  marks?: { page: number; x: number; y: number }[];
  bytes?: number;
}

export const manifest = JSON.parse(
  readFileSync(join(root, 'fixtures/manifest.json'), 'utf8'),
) as Entry[];

export const present = (e: Entry) => existsSync(join(root, e.path));
export const fixture = (path: string) => new Uint8Array(readFileSync(join(root, path)));
export const entry = (path: string) => manifest.find((e) => e.path === path)!;

/** Fixtures the fork decrypts silently wrong; inspection routes them to page images (spec §9.5). */
export const UNDECRYPTABLE = new Set(['fixtures/fetched/pdfjs/crypt_filters.pdf']);

export interface TextItem {
  str: string;
  /** [a, b, c, d, e, f] in PDF user space. */
  transform: number[];
}

/** Opens a document with pdf.js; call `close()` when done. */
export async function openWithPdfjs(bytes: Uint8Array, password?: string) {
  const task = getDocument({
    data: bytes.slice(),
    ...(password !== undefined ? { password } : {}),
    verbosity: VerbosityLevel.ERRORS,
  });
  const pdf = await task.promise;
  return Object.assign(pdf, { close: () => task.destroy() });
}

/** Text items per page, in PDF user space. */
export async function textItems(bytes: Uint8Array, password?: string): Promise<TextItem[][]> {
  const pdf = await openWithPdfjs(bytes, password);
  const pages: TextItem[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    pages.push(
      content.items.flatMap((item) =>
        'str' in item ? [{ str: item.str, transform: item.transform as number[] }] : [],
      ),
    );
  }
  await pdf.close();
  return pages;
}

export const pageText = (items: TextItem[]) => items.map((i) => i.str).join(' ');

export interface ViewportLike {
  convertToViewportPoint(x: number, y: number): number[];
}
export type ViewportClass = new (params: {
  viewBox: number[];
  userUnit: number;
  scale: number;
  rotation: number;
}) => ViewportLike;

/** pdf.js does not export PageViewport; take the class from a page's viewport. */
export async function pageViewportClass(): Promise<ViewportClass> {
  const pdf = await openWithPdfjs(fixture('fixtures/vendored/generated/rotate-0.pdf'));
  const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
  await pdf.close();
  return viewport.constructor as ViewportClass;
}
