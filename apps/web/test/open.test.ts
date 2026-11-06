// The open sequence (D1–D3, spec §6.1) with a fake pdf.js loader and core bridge.
import { fail, ok, type PdfInfo, type Problem } from '@bogey/core';
import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/config.ts';
import { pdfBridge, stubPdfBridge, type PdfBridge } from '../src/core-bridge/pdf.ts';
import { hasPdfHeader, readPdf } from '../src/features/open/accept.ts';
import { closeDocument, defaultServices, openDocument } from '../src/features/open/openDocument.ts';
import {
  inspectAndLoadStep,
  limitsStep,
  OPEN_STEPS,
  readStep,
  runSteps,
  undoSteps,
  type OpenServices,
  type OpenSession,
  type OpenStep,
} from '../src/features/open/openSteps.ts';
import {
  answerPassword,
  askPassword,
  cancelPasswordPrompt,
} from '../src/features/open/passwordPrompt.ts';
import { pdfjsLoader, setPdfjsLoader } from '../src/pdfjs/index.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useViewStore } from '../src/state/view.ts';
import { fakeDocument, fakeLoader, pdfFile } from './fakePdfjs.ts';

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe('accepting a file (D1, D2)', () => {
  it('finds the header anywhere in the first 1,024 bytes', () => {
    expect(hasPdfHeader(bytesOf('%PDF-1.4'))).toBe(true);
    expect(hasPdfHeader(bytesOf(`${' '.repeat(1019)}%PDF-`))).toBe(true);
    expect(hasPdfHeader(bytesOf(`${' '.repeat(1020)}%PDF-`))).toBe(false);
    expect(hasPdfHeader(bytesOf('%PDF'))).toBe(false);
    expect(hasPdfHeader(bytesOf('GIF89a'))).toBe(false);
  });

  it('refuses a file over the size limit without reading it', async () => {
    const arrayBuffer = vi.fn();
    const result = await readPdf({ size: LIMITS.maxFileBytes + 1, arrayBuffer });
    expect(result).toEqual(fail({ code: 'file.too-large', data: { limitMb: 50 } }));
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('decides the type by content and reports unreadable files', async () => {
    expect(await readPdf(new Blob(['<html>']))).toEqual(fail({ code: 'file.not-pdf' }));
    const read = await readPdf(new Blob(['%PDF-1.7']));
    expect(read.ok && new TextDecoder().decode(read.value)).toBe('%PDF-1.7');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unreadable = await readPdf({
      size: 10,
      arrayBuffer: () => Promise.reject(new Error('gone')),
    });
    expect(unreadable).toEqual(fail({ code: 'file.unreadable' }));
  });
});

const info = (overrides: Partial<PdfInfo> = {}): PdfInfo => ({
  formType: 'flat',
  xfa: 'none',
  encrypted: false,
  decryptable: true,
  pageCount: 3,
  pages: [],
  fields: [],
  initialValues: {},
  metadata: {},
  ...overrides,
});

const session = (file = pdfFile()): OpenSession => ({
  id: 'doc-1',
  name: file.name,
  file,
  bytes: null,
  info: null,
  display: null,
  password: null,
});

function services(overrides: Partial<OpenServices> = {}): OpenServices {
  return {
    bridge: stubPdfBridge,
    loader: fakeLoader(),
    askPassword: () => Promise.resolve(null),
    ...overrides,
  };
}

describe('the open steps (spec §6.1)', () => {
  it('reads, inspects and loads a plain document', async () => {
    const s = session();
    const loader = fakeLoader({ pageCount: 4 });
    expect(await runSteps(OPEN_STEPS, s, services({ loader }))).toEqual({ kind: 'next' });
    expect(s.bytes).toBeInstanceOf(Uint8Array);
    expect(s.info?.formType).toBe('flat');
    expect(s.display?.pageCount).toBe(4);
    expect(s.password).toBeNull();
    expect(loader.calls[0]!.password).toBeUndefined();
  });

  it('stops at the first failing step and undoes the earlier ones in reverse', async () => {
    const order: string[] = [];
    const step = (name: string, outcome: Awaited<ReturnType<OpenStep['run']>>): OpenStep => ({
      name,
      run: () => {
        order.push(`run ${name}`);
        return Promise.resolve(outcome);
      },
      undo: () => {
        order.push(`undo ${name}`);
        return Promise.resolve();
      },
    });
    const outcome = await runSteps(
      [
        step('a', { kind: 'next' }),
        step('b', { kind: 'next' }),
        step('c', { kind: 'failed', problem: { code: 'pdf.damaged' } }),
        step('d', { kind: 'next' }),
      ],
      session(),
      services(),
    );
    expect(outcome).toEqual({ kind: 'failed', problem: { code: 'pdf.damaged' } });
    expect(order).toEqual(['run a', 'run b', 'run c', 'undo b', 'undo a']);
  });

  it('treats an exception as a damaged document and survives a failing undo', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await runSteps(
      [
        {
          name: 'fragile',
          run: () => Promise.resolve({ kind: 'next' }),
          undo: () => Promise.reject(new Error('undo failed')),
        },
        { name: 'throws', run: () => Promise.reject(new Error('boom')) },
      ],
      session(),
      services(),
    );
    expect(outcome).toEqual({ kind: 'failed', problem: { code: 'pdf.damaged' } });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('passes a read failure on', async () => {
    const s = session(new File(['nope'], 'a.txt'));
    expect(await readStep.run(s, services())).toEqual({
      kind: 'failed',
      problem: { code: 'file.not-pdf' },
    });
  });

  it('asks for the password until it is right (D3)', async () => {
    const s = { ...session(), bytes: bytesOf('%PDF-') };
    const loader = fakeLoader({ password: 'bogey' });
    const reasons: Problem['code'][] = [];
    const answers = ['wrong', 'bogey'];
    const inspect = vi.fn(stubPdfBridge.inspect);
    const outcome = await inspectAndLoadStep.run(
      s,
      services({
        loader,
        bridge: { ...stubPdfBridge, inspect },
        askPassword: (reason) => {
          reasons.push(reason.code);
          return Promise.resolve(answers.shift()!);
        },
      }),
    );
    expect(outcome).toEqual({ kind: 'next' });
    expect(reasons).toEqual(['pdf.password-required', 'pdf.password-wrong']);
    expect(loader.calls.map((call) => call.password)).toEqual([undefined, 'wrong', 'bogey']);
    expect(inspect.mock.calls.map((call) => call[1])).toEqual([undefined, 'wrong', 'bogey']);
    expect(s.password).toBe('bogey');
    expect(s.info?.encrypted).toBe(true);
  });

  it('asks for a password when only inspection needs one, and stops on cancel', async () => {
    const s = { ...session(), bytes: bytesOf('%PDF-') };
    const loader = fakeLoader();
    const bridge: PdfBridge = {
      ...stubPdfBridge,
      inspect: () => Promise.resolve(fail({ code: 'pdf.password-required' })),
    };
    const askPassword = vi.fn(() => Promise.resolve(null));
    const outcome = await inspectAndLoadStep.run(s, services({ loader, bridge, askPassword }));
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(askPassword).toHaveBeenCalledOnce();
    // The display copy pdf.js loaded meanwhile is freed.
    expect(loader.documents[0]!.destroyed).toBe(true);
  });

  it('reports pdf.js failures before inspection failures', async () => {
    const s = { ...session(), bytes: bytesOf('%PDF-') };
    const bridge: PdfBridge = {
      ...stubPdfBridge,
      inspect: () => Promise.resolve(fail({ code: 'pdf.timeout' })),
    };
    expect(
      await inspectAndLoadStep.run(
        s,
        services({ bridge, loader: fakeLoader({ problem: { code: 'pdf.damaged' } }) }),
      ),
    ).toEqual({ kind: 'failed', problem: { code: 'pdf.damaged' } });
    expect(await inspectAndLoadStep.run(s, services({ bridge }))).toEqual({
      kind: 'failed',
      problem: { code: 'pdf.timeout' },
    });
  });

  it('undoes a load by destroying the display document', async () => {
    const display = fakeDocument(1);
    const s = { ...session(), display };
    await inspectAndLoadStep.undo!(s, services());
    expect(display.destroyed).toBe(true);
    expect(s.display).toBeNull();
    await inspectAndLoadStep.undo!(s, services());
  });

  it('refuses documents over the page limit', async () => {
    const big = { ...session(), display: fakeDocument(LIMITS.maxPages + 1) };
    expect(await limitsStep.run(big, services())).toEqual({
      kind: 'failed',
      problem: { code: 'file.too-many-pages', data: { limit: 2000 } },
    });
    const fine = { ...session(), display: fakeDocument(LIMITS.maxPages) };
    expect(await limitsStep.run(fine, services())).toEqual({ kind: 'next' });
  });

  it('undoes nothing when no step has an undo', async () => {
    await expect(undoSteps([readStep, limitsStep], session(), services())).resolves.toBe(undefined);
  });
});

describe('the password prompt', () => {
  it('waits for an answer and shows the reason in the document store', async () => {
    const answer = askPassword({ code: 'pdf.password-required' });
    expect(useDocumentStore.getState()).toMatchObject({
      status: 'password',
      problem: { code: 'pdf.password-required' },
    });
    answerPassword('secret');
    expect(await answer).toBe('secret');
    answerPassword('ignored');
  });

  it('withdraws an earlier question when a new one is asked or the prompt is cancelled', async () => {
    const first = askPassword({ code: 'pdf.password-required' });
    const second = askPassword({ code: 'pdf.password-wrong' });
    expect(await first).toBeNull();
    cancelPasswordPrompt();
    expect(await second).toBeNull();
  });
});

describe('opening into the stores', () => {
  it('opens a document, shows page 1, and frees the previous one', async () => {
    const loader = fakeLoader({ pageCount: 5 });
    useViewStore.getState().setPage(3);
    await openDocument(pdfFile('first.pdf'), services({ loader }));
    const first = useDocumentStore.getState();
    expect(first).toMatchObject({ status: 'ready', name: 'first.pdf', problem: null });
    expect(first.id).toMatch(/[0-9a-f-]{36}/);
    expect(first.display?.pageCount).toBe(5);
    expect(first.info?.formType).toBe('flat');
    expect(useViewStore.getState().page).toBe(0);

    await openDocument(pdfFile('second.pdf'), services({ loader }));
    expect(loader.documents[0]!.destroyed).toBe(true);
    expect(useDocumentStore.getState()).toMatchObject({ status: 'ready', name: 'second.pdf' });
  });

  it('records a failure for the drop zone to show', async () => {
    await openDocument(new File(['plain text'], 'notes.pdf'), services());
    expect(useDocumentStore.getState()).toMatchObject({
      status: 'error',
      name: 'notes.pdf',
      problem: { code: 'file.not-pdf' },
    });
  });

  it('returns to the empty state when the password is cancelled', async () => {
    await openDocument(
      pdfFile(),
      services({ loader: fakeLoader({ password: 'x' }), askPassword: () => Promise.resolve(null) }),
    );
    expect(useDocumentStore.getState().status).toBe('empty');
  });

  it('keeps only the newest of two overlapping opens', async () => {
    const loader = fakeLoader();
    let release!: () => void;
    const slowBridge: PdfBridge = {
      ...stubPdfBridge,
      inspect: (bytes, password) =>
        new Promise((resolve) => {
          release = () => void stubPdfBridge.inspect(bytes, password).then(resolve);
        }),
    };
    const slow = openDocument(pdfFile('slow.pdf'), services({ loader, bridge: slowBridge }));
    await vi.waitFor(() => expect(release).toBeDefined());
    await openDocument(pdfFile('fast.pdf'), services({ loader }));
    release();
    await slow;
    expect(useDocumentStore.getState().name).toBe('fast.pdf');
    const slowDocument = loader.documents.find(
      (doc) => doc !== useDocumentStore.getState().display,
    );
    expect(slowDocument?.destroyed).toBe(true);
  });

  it('a superseded open that fails changes nothing', async () => {
    let release!: () => void;
    const failing: PdfBridge = {
      ...stubPdfBridge,
      inspect: () =>
        new Promise((resolve) => {
          release = () => resolve(fail({ code: 'pdf.damaged' }));
        }),
    };
    const slow = openDocument(pdfFile('slow.pdf'), services({ bridge: failing }));
    await vi.waitFor(() => expect(release).toBeDefined());
    await openDocument(pdfFile('fast.pdf'), services());
    release();
    await slow;
    expect(useDocumentStore.getState()).toMatchObject({ status: 'ready', name: 'fast.pdf' });
  });

  it('closes the document', async () => {
    const display = fakeDocument(2);
    useDocumentStore.getState().update({ status: 'ready', display });
    useViewStore.getState().setRenderedZoom(1.5);
    await closeDocument();
    expect(display.destroyed).toBe(true);
    expect(useDocumentStore.getState().status).toBe('empty');
    expect(useViewStore.getState().renderedZoom).toBeNull();
    await closeDocument();
  });

  it('uses the installed bridge and loader by default', () => {
    const loader = fakeLoader();
    setPdfjsLoader(loader);
    expect(defaultServices()).toMatchObject({ bridge: pdfBridge(), loader });
    setPdfjsLoader(null);
    expect(pdfjsLoader()).not.toBe(loader);
    expect(ok(1).ok).toBe(true);
  });
});
