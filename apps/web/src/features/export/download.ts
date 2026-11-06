// The download itself (D8, E6, spec §9.1): a Blob of type application/pdf behind an anchor with a
// `download` name. Safari reads the blob URL after the click, so it is revoked later, not at once.
import { TIMING } from '../../config.ts';

export interface DownloadDeps {
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  click(anchor: HTMLAnchorElement): void;
  later(run: () => void, ms: number): void;
}

const browserDeps = (): DownloadDeps => ({
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  click: (anchor) => {
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  },
  later: (run, ms) => {
    setTimeout(run, ms);
  },
});

export function downloadPdf(
  bytes: Uint8Array,
  fileName: string,
  deps: DownloadDeps = browserDeps(),
): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  const url = deps.createUrl(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  deps.click(anchor);
  deps.later(() => deps.revokeUrl(url), TIMING.revokeDownloadUrlAfterMs);
}
