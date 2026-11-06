// Signatures in a real browser (spec §8, Sprint 3 exit criteria): draw with pen events and save,
// upload JPEG and PNG files on white, and read both back from IndexedDB after a "reload" (a
// second repository opened on the same database). Runs in Chromium, Firefox and WebKit.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { alphaBounds } from '../src/core-bridge/image.ts';
import { DrawDialog } from '../src/features/signatures/DrawDialog.tsx';
import { UploadDialog } from '../src/features/signatures/UploadDialog.tsx';
import { decodeUpload, TRIM_PADDING, type Pixels } from '../src/features/signatures/pixels.ts';
import { openRepository, type Repository } from '../src/state/persistence.ts';
import { useSignaturesStore } from '../src/state/signatures.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { penStroke } from './signatures-helpers.ts';

// The app's repository code against the browser's IndexedDB, under a database name of its own
// so this file cannot race the persistence test, which deletes the `bogey` database.
const TEST_DB = 'bogey-signatures-browser-test';
const factory = {
  open: (_name: string, version?: number) => indexedDB.open(TEST_DB, version),
  deleteDatabase: () => indexedDB.deleteDatabase(TEST_DB),
  cmp: (a: unknown, b: unknown) => indexedDB.cmp(a, b),
  databases: () => indexedDB.databases(),
} as IDBFactory;

// A desktop-sized frame, so the draw dialog has room for its 600 px minimum canvas.
beforeAll(() => page.viewport(1280, 900));

let repositories: Repository[] = [];
async function attachRepository() {
  const repository = await openRepository({ factory });
  expect(repository.mode).toBe('persistent');
  repositories.push(repository);
  useStorageStore.getState().attach(repository);
  return repository;
}

/** Opens the database afresh, as the app does after a reload, and loads the library from it. */
async function reload() {
  await useStorageStore.getState().repository!.flush();
  useSignaturesStore.getState().reset();
  const repository = await openRepository({ factory });
  repositories.push(repository);
  await useSignaturesStore.getState().load(repository);
  return useSignaturesStore.getState();
}

afterEach(async () => {
  cleanup();
  for (const repository of repositories.reverse()) await repository.clearEverything();
  repositories = [];
  useSignaturesStore.getState().reset();
  useStorageStore.getState().reset();
});

async function pixelsOf(png: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width: canvas.width, height: canvas.height };
}

const alphaAt = (p: Pixels, x: number, y: number) => p.data[(y * p.width + x) * 4 + 3]!;

/** An image file of dark strokes on white paper. */
async function inkOnWhite(width: number, height: number, type: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#123';
  ctx.lineWidth = height / 20;
  ctx.beginPath();
  ctx.moveTo(width * 0.2, height * 0.6);
  ctx.bezierCurveTo(
    width * 0.4,
    height * 0.1,
    width * 0.6,
    height * 0.9,
    width * 0.8,
    height * 0.4,
  );
  ctx.stroke();
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.92));
  return new File([blob], `signature.${type.split('/')[1]}`, { type });
}

/** Checks a stored signature: transparent margins, opaque ink, trimmed to the padding. */
async function expectTrimmedTransparent(png: Blob, pad: number) {
  const pixels = await pixelsOf(png);
  for (const [x, y] of [
    [0, 0],
    [pixels.width - 1, 0],
    [0, pixels.height - 1],
    [pixels.width - 1, pixels.height - 1],
  ] as const) {
    expect(alphaAt(pixels, x, y), `alpha at ${x},${y}`).toBe(0);
  }
  expect(pixels.data.some((value, i) => i % 4 === 3 && value === 255)).toBe(true);
  const ink = alphaBounds(pixels.data, pixels.width, pixels.height, 0)!;
  // The ink starts `pad` pixels in on each side (± 1 for anti-aliasing at the edge).
  expect(Math.abs(ink.x - pad)).toBeLessThanOrEqual(1);
  expect(Math.abs(ink.y - pad)).toBeLessThanOrEqual(1);
  expect(Math.abs(pixels.width - (ink.x + ink.width) - pad)).toBeLessThanOrEqual(1);
  expect(Math.abs(pixels.height - (ink.y + ink.height) - pad)).toBeLessThanOrEqual(1);
  return pixels;
}

describe('drawn signatures', () => {
  it('save as a trimmed transparent PNG and survive a reload', async () => {
    await attachRepository();
    let closed = false;
    render(<DrawDialog open onClose={() => (closed = true)} />);
    const canvas = screen.getByRole('img', { name: 'Signature drawing area' });
    const rect = canvas.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(600);
    const at = (x: number, y: number): [number, number] => [rect.left + x, rect.top + y];
    penStroke(canvas, [at(60, 120), at(120, 60), at(180, 130), at(240, 70), at(300, 110)]);
    penStroke(canvas, [at(320, 140), at(420, 140)], 2);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(closed).toBe(true));

    const [item] = useSignaturesStore.getState().items;
    const scale = window.devicePixelRatio || 1;
    const png = useSignaturesStore.getState().images.get(item!.id)!;
    const pixels = await expectTrimmedTransparent(png, Math.round(TRIM_PADDING * scale));
    expect([pixels.width, pixels.height]).toEqual([item!.width, item!.height]);
    // The ink spans x 60–420 CSS px, plus padding and half the line width.
    expect(item!.width / scale).toBeGreaterThan(360 + 2 * TRIM_PADDING);
    expect(item!.width / scale).toBeLessThan(360 + 2 * TRIM_PADDING + 6);

    const after = await reload();
    expect(after.items).toEqual([item]);
    const stored = after.images.get(item!.id)!;
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(
      new Uint8Array(await png.arrayBuffer()),
    );
  });
});

describe('uploaded signatures', () => {
  it('decode a JPEG on white, remove the background and survive a reload', async () => {
    await attachRepository();
    let closed = false;
    render(<UploadDialog open onClose={() => (closed = true)} />);
    await userEvent.upload(
      screen.getByLabelText('Image file'),
      await inkOnWhite(2400, 800, 'image/jpeg'),
    );
    await screen.findByRole('slider', { name: /Background cutoff/ });
    const preview = screen.getByRole('img', { name: /Preview/ }) as HTMLCanvasElement;
    await waitFor(() => expect(Math.max(preview.width, preview.height)).toBe(640));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(closed).toBe(true));

    const [item] = useSignaturesStore.getState().items;
    // Scaled to 2,000 px wide on decode, then trimmed to the ink (about 60% of the width).
    expect(item!.width).toBeLessThan(2000 * 0.7);
    expect(item!.width).toBeGreaterThan(2000 * 0.6);
    await expectTrimmedTransparent(
      useSignaturesStore.getState().images.get(item!.id)!,
      TRIM_PADDING,
    );
    const after = await reload();
    expect(after.items).toEqual([item]);
  });

  it('decode a PNG, capping an oversized image at 2,000 px', async () => {
    const result = await decodeUpload(await inkOnWhite(1200, 3000, 'image/png'));
    if (!result.ok) throw new Error(result.problems[0]!.code);
    expect(result.value.full).toMatchObject({ width: 800, height: 2000 });
    expect(result.value.preview).toMatchObject({ width: 256, height: 640 });
    // White paper stays opaque white until background removal runs.
    expect([...result.value.full.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it('refuse a file that is not an image', async () => {
    const result = await decodeUpload(
      new File(['%PDF-1.7'], 'form.pdf', { type: 'application/pdf' }),
    );
    expect(result).toEqual({ ok: false, problems: [{ code: 'signature.decode-failed' }] });
  });
});
