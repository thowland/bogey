// The web app's door to core's PDF work (spec §2, §4, §12). Inspection and export run in the pdf
// worker (workers/pdf.worker.ts) through comlink. The host here applies the timeouts in
// config.ts, terminates and replaces a worker that times out or crashes, retries an inspection
// once after a crash, and turns every failure into a classified problem (U6).
import {
  fail,
  type ExportInput,
  type ExportOutput,
  type ExportPageImagesInput,
  type ExportStage,
  type PdfInfo,
  type Problem,
  type Result,
} from '@bogey/core';
import { proxy, releaseProxy, transfer, wrap } from 'comlink';
import { TIMING } from '../config.ts';

export type { ExportPageImagesInput, PageImage } from '@bogey/core';

type StageListener = (stage: ExportStage) => void;

export interface PdfBridge {
  inspect(bytes: Uint8Array, password?: string): Promise<Result<PdfInfo, Problem>>;
  exportPdf(input: ExportInput, onStage?: StageListener): Promise<Result<ExportOutput, Problem>>;
  /**
   * The page-image export for originals the fork cannot decrypt (`PdfInfo.decryptable` false,
   * spec §9.5): pages rendered by pdf.js with `rotation: 0` over the view box, as JPEG.
   * Optional so test doubles of the Sprint 0 contract stay valid.
   */
  exportPageImages?(
    input: ExportPageImagesInput,
    onStage?: StageListener,
  ): Promise<Result<ExportOutput, Problem>>;
}

/** Every document looks flat with no fields, and export is unavailable (tests, no Worker). */
export const stubPdfBridge: PdfBridge = {
  inspect: (_bytes, password) =>
    Promise.resolve({
      ok: true,
      value: {
        formType: 'flat',
        xfa: 'none',
        encrypted: password !== undefined,
        decryptable: true,
        pageCount: 0,
        pages: [],
        fields: [],
        initialValues: {},
        metadata: {},
      },
    }),
  exportPdf: () => Promise.resolve(fail({ code: 'export.failed' })),
};

/** What the pdf worker exposes (workers/pdfWorkerApi.ts). */
export interface PdfWorkerApi {
  inspect(bytes: Uint8Array, password?: string): Promise<Result<PdfInfo, Problem>>;
  exportPdf(input: ExportInput, onStage?: StageListener): Promise<Result<ExportOutput, Problem>>;
  exportPageImages(
    input: ExportPageImagesInput,
    onStage?: StageListener,
  ): Promise<Result<ExportOutput, Problem>>;
}

/** One running worker: its API, a way to stop it, and its crash signal. */
export interface WorkerHandle {
  api: PdfWorkerApi;
  terminate(): void;
  /** Called on `error` and `messageerror` (out of memory, a failed module load, …). */
  onCrash(listener: () => void): void;
}

export interface HostTimeouts {
  inspectMs: number;
  exportMs: number;
}

const DEFAULT_TIMEOUTS: HostTimeouts = {
  inspectMs: TIMING.inspectTimeoutMs,
  exportMs: TIMING.exportTimeoutMs,
};

type Outcome<T> = { kind: 'done'; value: T } | { kind: 'timeout' } | { kind: 'crash' };

interface Live {
  handle: WorkerHandle;
  /** Settles when this worker crashes or is terminated. */
  dead: Promise<Outcome<never>>;
  kill(): void;
}

/** A bridge backed by a replaceable worker; `spawn` creates one (a fake in tests). */
export function createPdfWorkerBridge(
  spawn: () => WorkerHandle,
  timeouts: HostTimeouts = DEFAULT_TIMEOUTS,
): PdfBridge & { dispose(): void } {
  let live: Live | null = null;

  const current = (): Live => {
    if (live) return live;
    const handle = spawn();
    let kill!: () => void;
    const dead = new Promise<Outcome<never>>((resolve) => {
      kill = () => resolve({ kind: 'crash' });
    });
    const entry: Live = {
      handle,
      dead,
      kill: () => {
        if (live === entry) live = null;
        kill();
        handle.terminate();
      },
    };
    handle.onCrash(() => entry.kill());
    live = entry;
    return entry;
  };

  async function run<T>(call: (api: PdfWorkerApi) => Promise<T>, ms: number): Promise<Outcome<T>> {
    const worker = current();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Outcome<T>>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
    });
    const work = call(worker.handle.api).then(
      (value): Outcome<T> => ({ kind: 'done', value }),
      (): Outcome<T> => ({ kind: 'crash' }),
    );
    const outcome = await Promise.race([work, timeout, worker.dead]);
    clearTimeout(timer);
    // A worker that timed out or failed is terminated; the next call gets a fresh one (spec §12).
    if (outcome.kind !== 'done') worker.kill();
    return outcome;
  }

  const exportCall = async (
    call: (api: PdfWorkerApi) => Promise<Result<ExportOutput, Problem>>,
  ): Promise<Result<ExportOutput, Problem>> => {
    const outcome = await run(call, timeouts.exportMs);
    if (outcome.kind === 'done') return outcome.value;
    return fail({ code: outcome.kind === 'timeout' ? 'export.timeout' : 'export.failed' });
  };

  return {
    async inspect(bytes, password) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const outcome = await run((api) => api.inspect(bytes, password), timeouts.inspectMs);
        if (outcome.kind === 'done') return outcome.value;
        if (outcome.kind === 'timeout') return fail({ code: 'pdf.timeout' });
      }
      return fail({ code: 'pdf.damaged' });
    },
    exportPdf: (input, onStage) => exportCall((api) => api.exportPdf(input, onStage)),
    exportPageImages: (input, onStage) => exportCall((api) => api.exportPageImages(input, onStage)),
    dispose() {
      live?.kill();
    },
  };
}

/** The real worker. Only runs in a browser (exercised by the browser-mode tests and E2E). */
export function spawnPdfWorker(): WorkerHandle {
  const worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), {
    type: 'module',
    name: 'bogey-pdf',
  });
  const remote = wrap<PdfWorkerApi>(worker);
  const stage = (onStage?: StageListener) => (onStage ? proxy(onStage) : undefined);
  return {
    api: {
      // Structured clone copies the bytes, so the caller's original stays intact (E1).
      inspect: (bytes, password) => remote.inspect(bytes, password),
      exportPdf: (input, onStage) => remote.exportPdf(input, stage(onStage)),
      exportPageImages: (input, onStage) =>
        remote.exportPageImages(
          transfer(
            input,
            input.pages.map((p) => p.jpeg.buffer as ArrayBuffer),
          ),
          stage(onStage),
        ),
    },
    terminate: () => {
      remote[releaseProxy]();
      worker.terminate();
    },
    onCrash: (listener) => {
      worker.addEventListener('error', listener);
      worker.addEventListener('messageerror', listener);
    },
  };
}

let current: PdfBridge | null = null;

/** The worker-backed bridge where workers exist; the stub otherwise (jsdom). */
export const pdfBridge = (): PdfBridge =>
  (current ??=
    typeof Worker === 'undefined' ? stubPdfBridge : createPdfWorkerBridge(spawnPdfWorker));

/** For tests, or to install a different implementation. */
export function setPdfBridge(bridge: PdfBridge): void {
  current = bridge;
}
