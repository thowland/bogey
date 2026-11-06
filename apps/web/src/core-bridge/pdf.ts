// The web app's door to core's PDF work (spec §2, §4). Sprint 2 replaces the stub below with a
// comlink client for workers/pdf.worker.ts; the interface is the contract Sprints 1, 4 and 5 use.
import {
  fail,
  ok,
  type ExportInput,
  type ExportOutput,
  type ExportStage,
  type PdfInfo,
  type Problem,
  type Result,
} from '@bogey/core';

export interface PdfBridge {
  inspect(bytes: Uint8Array, password?: string): Promise<Result<PdfInfo, Problem>>;
  exportPdf(
    input: ExportInput,
    onStage?: (stage: ExportStage) => void,
  ): Promise<Result<ExportOutput, Problem>>;
}

/** Until Sprint 2: every document looks flat with no fields, and export is unavailable. */
export const stubPdfBridge: PdfBridge = {
  inspect: (_bytes, password) =>
    Promise.resolve(
      ok({
        formType: 'flat',
        xfa: 'none',
        encrypted: password !== undefined,
        decryptable: true,
        pageCount: 0,
        pages: [],
        fields: [],
        initialValues: {},
        metadata: {},
      }),
    ),
  exportPdf: () => Promise.resolve(fail({ code: 'export.failed' })),
};

let current: PdfBridge = stubPdfBridge;

export const pdfBridge = (): PdfBridge => current;

/** For tests, and for Sprint 2 to install the worker-backed bridge at start-up. */
export function setPdfBridge(bridge: PdfBridge): void {
  current = bridge;
}
