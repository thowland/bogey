// What the pdf worker does (spec §2, §9): core's inspection and export, with the exported bytes
// transferred rather than copied back to the page (spec §9.1).
import {
  exportPageImages,
  exportPdf,
  inspectPdf,
  type ExportOutput,
  type Result,
} from '@bogey/core';
import { transfer } from 'comlink';
import type { PdfWorkerApi } from '../core-bridge/pdf.ts';

const transferred = (r: Result<ExportOutput>) =>
  r.ok ? transfer(r, [r.value.bytes.buffer as ArrayBuffer]) : r;

export const pdfWorkerApi: PdfWorkerApi = {
  inspect: (bytes, password) => inspectPdf(bytes, password === undefined ? {} : { password }),
  exportPdf: async (input, onStage) => transferred(await exportPdf(input, onStage)),
  exportPageImages: async (input, onStage) => transferred(await exportPageImages(input, onStage)),
};
