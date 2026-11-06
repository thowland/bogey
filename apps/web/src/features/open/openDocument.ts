// Opening a document into the stores (spec §6.1). The steps themselves are in openSteps.ts; this
// module runs them for the newest file only and records the outcome in state/document.ts.
import { pdfBridge } from '../../core-bridge/pdf.ts';
import { pdfjsLoader } from '../../pdfjs/index.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useViewStore } from '../../state/view.ts';
import type { FileLike } from './accept.ts';
import {
  OPEN_STEPS,
  runSteps,
  undoSteps,
  type OpenServices,
  type OpenSession,
  type OpenStep,
} from './openSteps.ts';
import { askPassword, cancelPasswordPrompt } from './passwordPrompt.ts';

export type OpenableFile = FileLike & { readonly name: string };

export const defaultServices = (): OpenServices => ({
  bridge: pdfBridge(),
  loader: pdfjsLoader(),
  askPassword,
});

/** Increments with every open, so a slower earlier open never replaces a later one. */
let generation = 0;

const newId = () => crypto.randomUUID();

/** Closes the open document, if any, and frees its pdf.js resources. */
export async function closeDocument(): Promise<void> {
  const display = useDocumentStore.getState().display;
  useDocumentStore.getState().reset();
  useViewStore.getState().setPage(0);
  useViewStore.getState().setRenderedZoom(null);
  await display?.destroy();
}

export async function openDocument(
  file: OpenableFile,
  services: OpenServices = defaultServices(),
  steps: readonly OpenStep[] = OPEN_STEPS,
  /** A saved document's id, when reopening it (Sprint 6, D7). */
  id: string = newId(),
): Promise<void> {
  const current = ++generation;
  cancelPasswordPrompt();
  await closeDocument();
  const store = useDocumentStore.getState();
  store.update({ status: 'opening', name: file.name });

  const session: OpenSession = {
    id,
    name: file.name,
    file,
    bytes: null,
    info: null,
    display: null,
    password: null,
  };
  const outcome = await runSteps(steps, session, services);

  if (current !== generation) {
    if (outcome.kind === 'next') await undoSteps(steps, session, services);
    return;
  }
  if (outcome.kind === 'cancelled') {
    store.reset();
  } else if (outcome.kind === 'failed') {
    store.update({ status: 'error', problem: outcome.problem });
  } else {
    useViewStore.getState().setPage(0);
    store.update({
      status: 'ready',
      id: session.id,
      bytes: session.bytes,
      info: session.info,
      display: session.display,
      password: session.password,
      problem: null,
    });
  }
}
