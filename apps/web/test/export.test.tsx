// The export flow and dialog (D8, E1–E9, spec §9).
import type { ExportInput, ExportPageImagesInput, Overlay, PdfInfo } from '@bogey/core';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../src/config.ts';
import { setPdfBridge, type PdfBridge } from '../src/core-bridge/pdf.ts';
import { downloadPdf } from '../src/features/export/download.ts';
import type * as DownloadModule from '../src/features/export/download.ts';
import {
  ENCRYPTED_NOTICE,
  PAGE_IMAGES_NOTICE,
  REPLACE_LABEL,
} from '../src/features/export/ExportDialog.tsx';
import { ExportButton, isSaveKey } from '../src/features/export/ExportButton.tsx';
import {
  needsConfirmation,
  planExport,
  runExport,
  signatureImages,
  type ExportDeps,
} from '../src/features/export/exportFlow.ts';
import { PAGE_IMAGE_ZOOM, imageSize, unrotate } from '../src/features/export/pageImages.ts';
import type { PdfDisplayDocument } from '../src/pdfjs/index.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { useSignaturesStore } from '../src/state/signatures.ts';
import { useViewStore } from '../src/state/view.ts';
import { Toasts } from '../src/ui/Toast.tsx';

vi.mock('../src/features/export/download.ts', { spy: true });

const info = (over: Partial<PdfInfo> = {}): PdfInfo => ({
  formType: 'flat',
  xfa: 'none',
  encrypted: false,
  decryptable: true,
  pageCount: 1,
  pages: [{ index: 0, view: [0, 0, 612, 792], rotate: 0, userUnit: 1 }],
  fields: [],
  initialValues: {},
  metadata: {},
  ...over,
});

const display = { pageCount: 1 } as PdfDisplayDocument;

function openDoc(over: Partial<PdfInfo> = {}, password: string | null = null) {
  useDocumentStore.getState().update({
    status: 'ready',
    name: 'Lease: draft.PDF',
    bytes: new Uint8Array([37, 80, 68, 70]),
    info: info(over),
    display,
    password,
  });
}

const addOverlay = (overlay: Overlay) =>
  useEditsStore.getState().edit({ type: 'addOverlay', overlay });
const textOverlay = (text: string): Overlay => ({
  id: 't',
  type: 'text',
  page: 0,
  x: 72,
  y: 700,
  text,
  size: 10,
  bold: false,
});

const OUTPUT = new Uint8Array([1, 2, 3]);

function fakeBridge(over: Partial<PdfBridge> = {}) {
  const calls: { pdf: ExportInput[]; images: ExportPageImagesInput[] } = { pdf: [], images: [] };
  const bridge: PdfBridge = {
    inspect: () => Promise.reject(new Error('unused')),
    exportPdf: (input, onStage) => {
      calls.pdf.push(input);
      onStage?.('loading');
      onStage?.('saving');
      return Promise.resolve({ ok: true, value: { bytes: OUTPUT, rasterized: false } });
    },
    exportPageImages: (input, onStage) => {
      calls.images.push(input);
      onStage?.('drawing');
      return Promise.resolve({ ok: true, value: { bytes: OUTPUT, rasterized: true } });
    },
    ...over,
  };
  return { bridge, calls };
}

function deps(bridge: PdfBridge): ExportDeps & { downloads: [Uint8Array, string][] } {
  const downloads: [Uint8Array, string][] = [];
  return {
    bridge,
    renderPages: () => Promise.resolve([{ jpeg: new Uint8Array([255, 216]) }]),
    download: (bytes, name) => downloads.push([bytes, name]),
    now: () => 1234,
    downloads,
  };
}

beforeEach(() => {
  vi.mocked(downloadPdf).mockImplementation(() => undefined);
  vi.mocked(downloadPdf).mockClear();
});

describe('planExport', () => {
  it('is null without a document', () => {
    expect(planExport()).toBeNull();
  });

  it('names the file and lists what needs a warning', () => {
    openDoc({ encrypted: true });
    addOverlay(textOverlay('Price → €5 ✓'));
    const plan = planExport()!;
    expect(plan.fileName).toBe('Lease draft-signed.pdf');
    expect(plan.encrypted).toBe(true);
    expect(plan.pageImages).toBe(false);
    expect(plan.warnings).toEqual([
      { subject: { kind: 'overlay', id: 't', page: 0 }, characters: ['→', '✓'] },
    ]);
    expect(needsConfirmation(plan)).toBe(true);
  });

  it('needs no confirmation for a plain document', () => {
    openDoc();
    addOverlay(textOverlay('Plain'));
    expect(needsConfirmation(planExport()!)).toBe(false);
    openDoc({ decryptable: false });
    expect(needsConfirmation(planExport()!)).toBe(true);
  });
});

describe('runExport', () => {
  it('exports the original with the password, signatures and options, then downloads', async () => {
    openDoc({}, 'secret');
    useSignaturesStore
      .getState()
      .setAll(
        [{ id: 'lib', name: 'Tim', kind: 'signature', width: 30, height: 10, createdAt: 1 }],
        new Map([['lib', new Blob([new Uint8Array([137, 80])], { type: 'image/png' })]]),
      );
    const sig = {
      id: 's',
      type: 'signature',
      page: 0,
      x: 1,
      y: 1,
      width: 150,
      height: 50,
    } as const;
    addOverlay({ ...sig, signatureId: 'lib' });
    addOverlay({ ...sig, id: 's2', signatureId: 'lib' });
    addOverlay({ ...sig, id: 's3', signatureId: 'gone' });
    const { bridge, calls } = fakeBridge();
    const d = deps(bridge);
    const stages: string[] = [];
    const result = await runExport({ replaceNonWinAnsi: true }, (s) => stages.push(s), d);
    expect(result).toEqual({ ok: true, value: { fileName: 'Lease draft-signed.pdf' } });
    const input = calls.pdf[0]!;
    expect(input.bytes).toBe(useDocumentStore.getState().bytes);
    expect(input.password).toBe('secret');
    expect(input.options).toEqual({ replaceNonWinAnsi: true, now: 1234 });
    expect([...input.signatures.keys()]).toEqual(['lib']);
    expect(input.signatures.get('lib')).toEqual({
      png: new Uint8Array([137, 80]),
      width: 30,
      height: 10,
    });
    expect(stages).toEqual(['loading', 'saving']);
    expect(d.downloads).toEqual([[OUTPUT, 'Lease draft-signed.pdf']]);
  });

  it('leaves out the password when there is none', async () => {
    openDoc();
    const { bridge, calls } = fakeBridge();
    await runExport({ replaceNonWinAnsi: false }, () => undefined, deps(bridge));
    expect(calls.pdf[0]).not.toHaveProperty('password');
  });

  it('uses page images when the original cannot be decrypted (spec §9.5)', async () => {
    openDoc({ decryptable: false, encrypted: true });
    const { bridge, calls } = fakeBridge();
    const d = deps(bridge);
    const stages: string[] = [];
    const result = await runExport({ replaceNonWinAnsi: false }, (s) => stages.push(s), d);
    expect(result.ok).toBe(true);
    expect(calls.pdf).toHaveLength(0);
    expect(calls.images[0]!.pages).toEqual([{ jpeg: new Uint8Array([255, 216]) }]);
    expect(stages).toEqual(['rendering', 'drawing']);
  });

  it('reports cannot-decrypt without a page-image export', async () => {
    openDoc({ decryptable: false });
    const { bridge } = fakeBridge();
    delete bridge.exportPageImages;
    expect(await runExport({ replaceNonWinAnsi: false }, () => undefined, deps(bridge))).toEqual({
      ok: false,
      problems: [{ code: 'export.cannot-decrypt' }],
    });
  });

  it('passes on core’s problems and downloads nothing', async () => {
    openDoc();
    const { bridge } = fakeBridge({
      exportPdf: () => Promise.resolve({ ok: false, problems: [{ code: 'export.verify-failed' }] }),
    });
    const d = deps(bridge);
    const result = await runExport({ replaceNonWinAnsi: false }, () => undefined, d);
    expect(result).toEqual({ ok: false, problems: [{ code: 'export.verify-failed' }] });
    expect(d.downloads).toHaveLength(0);
  });

  it('turns a thrown error into export.failed', async () => {
    openDoc();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { bridge } = fakeBridge({ exportPdf: () => Promise.reject(new Error('boom')) });
    expect(await runExport({ replaceNonWinAnsi: false }, () => undefined, deps(bridge))).toEqual({
      ok: false,
      problems: [{ code: 'export.failed' }],
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('fails without a document', async () => {
    const { bridge } = fakeBridge();
    expect((await runExport({ replaceNonWinAnsi: false }, () => undefined, deps(bridge))).ok).toBe(
      false,
    );
  });

  it('reads no images when no signature is placed', async () => {
    expect((await signatureImages([textOverlay('x')])).size).toBe(0);
  });
});

describe('downloadPdf', () => {
  it('clicks an anchor named for the file and revokes the URL a minute later', async () => {
    const { downloadPdf: real } = await vi.importActual<typeof DownloadModule>(
      '../src/features/export/download.ts',
    );
    const clicked: HTMLAnchorElement[] = [];
    const revoked: string[] = [];
    let later: [() => void, number] | null = null;
    let blob: Blob | null = null;
    real(OUTPUT, 'a-signed.pdf', {
      createUrl: (b) => {
        blob = b;
        return 'blob:x';
      },
      revokeUrl: (url) => revoked.push(url),
      click: (a) => clicked.push(a),
      later: (run, ms) => {
        later = [run, ms];
      },
    });
    expect(blob!.type).toBe('application/pdf');
    expect(clicked[0]!.download).toBe('a-signed.pdf');
    expect(clicked[0]!.getAttribute('href')).toBe('blob:x');
    expect(revoked).toEqual([]);
    expect(later![1]).toBe(TIMING.revokeDownloadUrlAfterMs);
    later![0]();
    expect(revoked).toEqual(['blob:x']);
  });

  it('uses the browser by default', async () => {
    const { downloadPdf: real } = await vi.importActual<typeof DownloadModule>(
      '../src/features/export/download.ts',
    );
    vi.useFakeTimers();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    real(OUTPUT, 'b.pdf');
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(TIMING.revokeDownloadUrlAfterMs);
    expect(revoke).toHaveBeenCalledOnce();
    click.mockRestore();
    revoke.mockRestore();
    vi.useRealTimers();
  });
});

describe('page images', () => {
  it('sizes pages at 200 dpi, within the canvas pixel limit', () => {
    expect(imageSize({ width: 816, height: 1056 }, PAGE_IMAGE_ZOOM)).toEqual({
      width: 1700,
      height: 2200,
    });
    const capped = imageSize({ width: 1000, height: 1000 }, 10, 1_000_000);
    expect(capped.width * capped.height).toBeLessThanOrEqual(1_000_000);
    expect(capped.width).toBe(1000);
  });

  it('turns a displayed page back to unrotated', () => {
    expect(unrotate(0, 10, 20)).toEqual({ dx: 0, dy: 0, radians: 0 });
    expect(unrotate(90, 10, 20)).toEqual({ dx: 0, dy: 20, radians: -Math.PI / 2 });
    expect(unrotate(180, 10, 20)).toEqual({ dx: 10, dy: 20, radians: Math.PI });
    expect(unrotate(270, 10, 20)).toEqual({ dx: 10, dy: 0, radians: Math.PI / 2 });
  });
});

describe('ExportButton', () => {
  const setup = (bridge = fakeBridge().bridge) => {
    setPdfBridge(bridge);
    render(
      <>
        <ExportButton />
        <Toasts />
      </>,
    );
    return userEvent.setup();
  };

  it('is disabled without a document', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('downloads at once when there is nothing to ask', async () => {
    openDoc();
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Downloaded Lease draft-signed.pdf.')).toBeInTheDocument();
    expect(downloadPdf).toHaveBeenCalledWith(OUTPUT, 'Lease draft-signed.pdf');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists characters to replace and replaces them on confirmation (E4)', async () => {
    openDoc({
      fields: [
        {
          name: 'Name',
          kind: 'text',
          supported: true,
          readOnly: false,
          required: false,
          fontSize: 0,
          textAlign: 'left',
          widgets: [{ page: 0, rect: [0, 0, 10, 10], mkRotation: 0 }],
          tabOrder: 0,
        },
      ],
    });
    addOverlay(textOverlay('Go →'));
    useEditsStore.getState().edit({ type: 'setField', name: 'Name', value: 'Zoë ✓' });
    const { bridge, calls } = fakeBridge();
    const user = setup(bridge);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    const dialog = screen.getByRole('dialog', { name: 'Download a signed copy' });
    expect(dialog).toHaveTextContent('Text on page 1, “Go →”: “→”');
    expect(dialog).toHaveTextContent('The field “Name” on page 1: “✓”');
    expect(dialog).toHaveTextContent('Lease draft-signed.pdf');
    await user.click(screen.getByRole('button', { name: REPLACE_LABEL }));
    expect(await screen.findByText(/^Downloaded/)).toBeInTheDocument();
    expect(calls.pdf[0]!.options.replaceNonWinAnsi).toBe(true);
  });

  it('cancels without exporting', async () => {
    openDoc({ encrypted: true });
    const { bridge, calls } = fakeBridge();
    const user = setup(bridge);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(ENCRYPTED_NOTICE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.pdf).toHaveLength(0);
  });

  it('says the copy is made of page images, and confirms with Download', async () => {
    openDoc({ encrypted: true, decryptable: false });
    const { bridge, calls } = fakeBridge();
    setPdfBridge(bridge);
    const user = setup(bridge);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(PAGE_IMAGES_NOTICE);
    expect(dialog).not.toHaveTextContent(ENCRYPTED_NOTICE);
    // jsdom has no canvas, so rendering the pages fails and the dialog says so.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('could not be produced');
    expect(calls.images).toHaveLength(0);
    error.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows the problem when export fails', async () => {
    openDoc();
    const user = setup(
      fakeBridge({
        exportPdf: () => Promise.resolve({ ok: false, problems: [{ code: 'export.timeout' }] }),
      }).bridge,
    );
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('took too long');
  });

  it('shows progress with the stage once export passes 500 ms (E7)', async () => {
    openDoc();
    let finish!: () => void;
    let stage!: (s: 'drawing') => void;
    const user = setup(
      fakeBridge({
        exportPdf: (_input, onStage) =>
          new Promise((resolve) => {
            stage = (s) => onStage?.(s);
            finish = () => resolve({ ok: true, value: { bytes: OUTPUT, rasterized: false } });
          }),
      }).bridge,
    );
    vi.useFakeTimers();
    act(() => screen.getByRole('button', { name: 'Download' }).click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog', { name: 'Preparing your download' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(TIMING.exportProgressAfterMs));
    const dialog = screen.getByRole('dialog', { name: 'Preparing your download' });
    expect(dialog).toHaveTextContent('Starting…');
    act(() => stage('drawing'));
    expect(dialog).toHaveTextContent('Adding your text, marks and signatures…');
    vi.useRealTimers();
    await act(async () => finish());
    void user;
    expect(await screen.findByText(/^Downloaded/)).toBeInTheDocument();
  });

  it('opens with Cmd/Ctrl+S, and keeps the browser from saving the page', async () => {
    openDoc();
    const user = setup();
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText(/^Downloaded/)).toBeInTheDocument();
    // Elsewhere than the workspace, the key is swallowed and nothing happens.
    vi.mocked(downloadPdf).mockClear();
    useViewStore.getState().setScreen('help');
    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('recognises the save key', () => {
    const ev = (over: Partial<KeyboardEvent>) =>
      ({
        key: 's',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        ...over,
      }) as KeyboardEvent;
    expect(isSaveKey(ev({ metaKey: true }))).toBe(true);
    expect(isSaveKey(ev({ ctrlKey: true, key: 'S' }))).toBe(true);
    expect(isSaveKey(ev({}))).toBe(false);
    expect(isSaveKey(ev({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
