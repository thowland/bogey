// The app's handle on pdf.js. The real loader is imported on first use, which keeps pdf.js out of
// the start-up bundle and lets jsdom tests install a fake with setPdfjsLoader.
import type { PdfjsLoader } from './types.ts';

const onDemand: PdfjsLoader = {
  load: async (bytes, password) => (await import('./loader.ts')).load(bytes, password),
};

let current: PdfjsLoader = onDemand;

export const pdfjsLoader = (): PdfjsLoader => current;

/** For tests: install a fake loader, or pass null to restore the real one. */
export function setPdfjsLoader(loader: PdfjsLoader | null): void {
  current = loader ?? onDemand;
}

export type * from './types.ts';
export { RenderCancelled, RenderTimedOut } from './types.ts';
