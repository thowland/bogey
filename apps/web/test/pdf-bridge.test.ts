// The pdf worker host (spec §12): timeouts, crash and retry, replace-on-crash, with a fake worker.
import type { ExportInput, PdfInfo, Result } from '@bogey/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createPdfWorkerBridge,
  pdfBridge,
  stubPdfBridge,
  type PdfWorkerApi,
  type WorkerHandle,
} from '../src/core-bridge/pdf.ts';

const info = { pageCount: 1 } as PdfInfo;
const never = <T>() => new Promise<T>(() => undefined);
const okInfo = (): Promise<Result<PdfInfo>> => Promise.resolve({ ok: true, value: info });
const okExport = () =>
  Promise.resolve({ ok: true as const, value: { bytes: new Uint8Array([1]), rasterized: false } });

/** A fake worker whose behaviour is scripted per spawned instance. */
function fakes(behaviours: Partial<PdfWorkerApi>[]) {
  const spawned: { handle: WorkerHandle; crash: () => void; terminated: boolean }[] = [];
  const spawn = (): WorkerHandle => {
    const api: PdfWorkerApi = {
      inspect: okInfo,
      exportPdf: okExport,
      exportPageImages: okExport,
      ...behaviours[spawned.length],
    };
    const listeners: (() => void)[] = [];
    const record = {
      handle: {
        api,
        terminate: () => {
          record.terminated = true;
        },
        onCrash: (l: () => void) => listeners.push(l),
      },
      crash: () => listeners.forEach((l) => l()),
      terminated: false,
    };
    spawned.push(record);
    return record.handle;
  };
  return { spawn, spawned };
}

const timeouts = { inspectMs: 20, exportMs: 20 };

describe('pdf worker host', () => {
  it('passes results through and reuses one worker', async () => {
    const { spawn, spawned } = fakes([{}]);
    const bridge = createPdfWorkerBridge(spawn, timeouts);
    expect(await bridge.inspect(new Uint8Array(), 'pw')).toEqual({ ok: true, value: info });
    expect((await bridge.exportPdf({} as ExportInput)).ok).toBe(true);
    expect((await bridge.exportPageImages!({} as never)).ok).toBe(true);
    expect(spawned).toHaveLength(1);
    bridge.dispose();
    expect(spawned[0]!.terminated).toBe(true);
  });

  it('times out, terminates and replaces the worker', async () => {
    const { spawn, spawned } = fakes([{ inspect: never, exportPdf: never }, {}]);
    const bridge = createPdfWorkerBridge(spawn, timeouts);
    expect(await bridge.inspect(new Uint8Array())).toEqual({
      ok: false,
      problems: [{ code: 'pdf.timeout' }],
    });
    expect(spawned[0]!.terminated).toBe(true);
    expect(await bridge.inspect(new Uint8Array())).toEqual({ ok: true, value: info });
    expect(spawned).toHaveLength(2);
    const { spawn: spawn2 } = fakes([{ exportPdf: never }]);
    const exporter = createPdfWorkerBridge(spawn2, timeouts);
    expect(await exporter.exportPdf({} as ExportInput)).toEqual({
      ok: false,
      problems: [{ code: 'export.timeout' }],
    });
  });

  it('retries an inspection once after a crash, then reports pdf.damaged', async () => {
    const { spawn, spawned } = fakes([{ inspect: () => Promise.reject(new Error('oom')) }, {}]);
    const bridge = createPdfWorkerBridge(spawn, timeouts);
    expect(await bridge.inspect(new Uint8Array())).toEqual({ ok: true, value: info });
    expect(spawned).toHaveLength(2);

    let crashes: (() => void) | undefined;
    const twice = fakes([
      { inspect: () => (crashes!(), never()) },
      { inspect: () => (crashes!(), never()) },
    ]);
    const wrapped = () => {
      const handle = twice.spawn();
      crashes = twice.spawned.at(-1)!.crash;
      return handle;
    };
    const failing = createPdfWorkerBridge(wrapped, { inspectMs: 1_000, exportMs: 1_000 });
    expect(await failing.inspect(new Uint8Array())).toEqual({
      ok: false,
      problems: [{ code: 'pdf.damaged' }],
    });
    expect(twice.spawned.every((s) => s.terminated)).toBe(true);
  });

  it('reports a crashed export as export.failed', async () => {
    const { spawn } = fakes([{ exportPdf: () => Promise.reject(new Error('gone')) }]);
    const bridge = createPdfWorkerBridge(spawn, timeouts);
    expect(await bridge.exportPdf({} as ExportInput)).toEqual({
      ok: false,
      problems: [{ code: 'export.failed' }],
    });
  });

  it('forwards export stages', async () => {
    const stages: string[] = [];
    const { spawn } = fakes([
      {
        exportPdf: (_input, onStage) => {
          onStage?.('loading');
          return okExport();
        },
      },
    ]);
    const bridge = createPdfWorkerBridge(spawn, timeouts);
    await bridge.exportPdf({} as ExportInput, (s) => stages.push(s));
    expect(stages).toEqual(['loading']);
  });

  it('uses the stub where workers do not exist (jsdom)', () => {
    vi.stubGlobal('Worker', undefined);
    expect(pdfBridge()).toBe(stubPdfBridge);
    vi.unstubAllGlobals();
  });
});
