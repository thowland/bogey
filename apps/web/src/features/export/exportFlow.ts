// The export flow (D8, E1–E9, spec §9): what the dialog needs to ask before export, and the
// export itself in the pdf worker, followed by the download. State comes from the stores; the
// worker, page rendering and download are injectable so the flow is tested without a browser.
import type {
  DocumentEditState,
  ExportStage,
  ExportWarning,
  Overlay,
  PageGeometry,
  Problem,
  Result,
  SignatureImage,
} from '@bogey/core';
import { pdfBridge, type PdfBridge, type PageImage } from '../../core-bridge/pdf.ts';
import { outputFileName, preflightExport } from '../../core-bridge/text.ts';
import type { PdfDisplayDocument } from '../../pdfjs/index.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useSignaturesStore } from '../../state/signatures.ts';
import { downloadPdf } from './download.ts';
import { renderPageImages } from './pageImages.ts';

export interface ExportPlan {
  fileName: string;
  /** E4: overlays and fields with characters Helvetica cannot encode. */
  warnings: ExportWarning[];
  /** E9: the original was password-protected; the copy will not be. */
  encrypted: boolean;
  /** spec §9.5: the copy is made from page images. */
  pageImages: boolean;
}

/** What export will do for the open document, or null when there is none. */
export function planExport(): ExportPlan | null {
  const doc = useDocumentStore.getState();
  if (doc.status !== 'ready' || !doc.info || !doc.bytes) return null;
  return {
    fileName: outputFileName(doc.name ?? ''),
    warnings: preflightExport(useEditsStore.getState().present, doc.info.fields),
    encrypted: doc.info.encrypted,
    pageImages: !doc.info.decryptable,
  };
}

/** The dialog asks first when there is something to warn about (E4, E9, spec §9.5). */
export const needsConfirmation = (plan: ExportPlan): boolean =>
  plan.warnings.length > 0 || plan.encrypted || plan.pageImages;

/** Export stages, plus rendering the page images that precedes the page-image export. */
export type FlowStage = ExportStage | 'rendering';

export interface ExportDeps {
  bridge: PdfBridge;
  renderPages(
    display: PdfDisplayDocument,
    info: { pages: readonly PageGeometry[] },
  ): Promise<PageImage[]>;
  download(bytes: Uint8Array, fileName: string): void;
  now(): number;
}

export const defaultDeps = (): ExportDeps => ({
  bridge: pdfBridge(),
  renderPages: (display, info) => renderPageImages(display, info.pages),
  download: (bytes, name) => downloadPdf(bytes, name),
  now: () => Date.now(),
});

/**
 * The signature images placed overlays use, read from the library at export time (spec §8.3). A
 * signature deleted from the library is left out, and core names the pages that need it.
 */
export async function signatureImages(
  overlays: readonly Overlay[],
): Promise<Map<string, SignatureImage>> {
  const { items, images } = useSignaturesStore.getState();
  const out = new Map<string, SignatureImage>();
  for (const overlay of overlays) {
    if (overlay.type !== 'signature' || out.has(overlay.signatureId)) continue;
    const png = images.get(overlay.signatureId);
    const meta = items.find((item) => item.id === overlay.signatureId);
    if (!png || !meta) continue;
    out.set(overlay.signatureId, {
      png: new Uint8Array(await png.arrayBuffer()),
      width: meta.width,
      height: meta.height,
    });
  }
  return out;
}

const failed = (code: Problem['code']): Result<never, Problem> => ({
  ok: false,
  problems: [{ code }],
});

/**
 * Runs the export on the stored original (E1) and downloads the result as `fileName` (D8).
 * `replaceNonWinAnsi` is the user's answer to the preflight (E4).
 */
export async function runExport(
  options: { replaceNonWinAnsi: boolean },
  onStage: (stage: FlowStage) => void,
  deps: ExportDeps = defaultDeps(),
): Promise<Result<{ fileName: string }, Problem>> {
  const doc = useDocumentStore.getState();
  if (!doc.info || !doc.bytes) return failed('export.failed');
  const info = doc.info;
  const state: DocumentEditState = useEditsStore.getState().present;
  const fileName = outputFileName(doc.name ?? '');
  try {
    const signatures = await signatureImages(state.overlays);
    const exportOptions = { replaceNonWinAnsi: options.replaceNonWinAnsi, now: deps.now() };
    let result;
    if (info.decryptable) {
      result = await deps.bridge.exportPdf(
        {
          bytes: doc.bytes,
          ...(doc.password !== null ? { password: doc.password } : {}),
          info,
          state,
          signatures,
          options: exportOptions,
        },
        onStage,
      );
    } else {
      if (!doc.display || !deps.bridge.exportPageImages) return failed('export.cannot-decrypt');
      onStage('rendering');
      const pages = await deps.renderPages(doc.display, info);
      result = await deps.bridge.exportPageImages(
        { pages, info, state, signatures, options: exportOptions },
        onStage,
      );
    }
    if (!result.ok) return result;
    deps.download(result.value.bytes, fileName);
    return { ok: true, value: { fileName } };
  } catch (error) {
    console.error('Export failed', error);
    return failed('export.failed');
  }
}
