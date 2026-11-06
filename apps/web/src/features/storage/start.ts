// Wires saved documents into the app (spec §10.5): at start-up the library is read, expired and
// unreadable records are removed, the session controller starts, and the active document is
// reopened (D7). The recent list's open and delete actions and Clear everything (S7) are here too.
import { closeDocument, defaultServices, openDocument } from '../open/openDocument.ts';
import { OPEN_STEPS, type OpenServices, type OpenStep } from '../open/openSteps.ts';
import { useDocumentStore } from '../../state/document.ts';
import type { Repository } from '../../state/persistence.ts';
import {
  createSessionController,
  deleteDocuments,
  loadSessionSettings,
  migrateRecord,
  prepareLibrary,
  useSessionStore,
  writeSetting,
  type SessionController,
  type SessionControllerOptions,
} from '../../state/session.ts';
import { useStorageStore } from '../../state/storage.ts';
import { recordThumbnail } from './thumbnail.ts';

/** Reopening saved bytes skips the persist step: they are stored already. */
export const RESTORE_STEPS: readonly OpenStep[] = OPEN_STEPS.filter(
  (step) => step.name !== 'persist',
);

let controller: SessionController | null = null;
let startedWith: Repository | null = null;

export interface StartOptions {
  services?: () => OpenServices;
  controller?: Partial<Omit<SessionControllerOptions, 'repository'>>;
  now?: () => number;
}

let services: () => OpenServices = defaultServices;

const browserControllerOptions = (): Partial<SessionControllerOptions> => ({
  makeThumbnail: (display) => recordThumbnail(display),
  requestPersistence: () => {
    const storage = globalThis.navigator?.storage;
    return typeof storage?.persist === 'function' ? storage.persist() : Promise.resolve(false);
  },
  ...(typeof document === 'undefined' ? {} : { document }),
  ...(typeof window === 'undefined' ? {} : { window }),
});

/**
 * Starts the session for `repository`: prepares the library, starts autosave and reopens the
 * active document. Resolves when the restore has finished (it may wait for a password).
 */
export async function startSession(
  repository: Repository,
  options: StartOptions = {},
): Promise<void> {
  if (startedWith === repository) return;
  startedWith = repository;
  services = options.services ?? defaultServices;
  const now = options.now ?? (() => Date.now());
  const activeId = await loadSessionSettings(repository);
  await prepareLibrary(repository, now());
  controller?.stop();
  controller = createSessionController({
    ...browserControllerOptions(),
    ...options.controller,
    repository,
    now,
  });
  controller.start();
  // Something may have been opened while the library was read; it wins.
  if (activeId && useDocumentStore.getState().status === 'empty') {
    await openSaved(activeId, { restoring: true });
  }
}

/** Stops the session (tests, and Clear everything). */
export function stopSession(): void {
  controller?.stop();
  controller = null;
  startedWith = null;
}

/**
 * Reopens a saved document at its page and zoom with its values and overlays (D6, D7). An
 * encrypted document asks for its password again. A record or bytes that are gone leave the empty
 * state with a notice.
 */
export async function openSaved(id: string, { restoring = false } = {}): Promise<void> {
  const repository = useStorageStore.getState().repository;
  if (!repository || !controller) return;
  const session = useSessionStore.getState();
  const [raw, bytes] = await Promise.all([
    repository.get('documents', id),
    repository.get('documentBytes', id),
  ]);
  const record = raw ? migrateRecord(raw) : null;
  if (!record || !bytes) {
    await deleteDocuments(repository, [id]);
    if (restoring) await writeSetting(repository, 'activeDocumentId', null);
    session.setNotice('restore-missing');
    return;
  }
  controller.expect(record);
  session.markSaved(id, true);
  const file = new File([bytes.bytes], record.name, { type: 'application/pdf' });
  await openDocument(file, services(), RESTORE_STEPS, id);
  const opened = useDocumentStore.getState();
  if (opened.status !== 'ready' || opened.id !== id) {
    controller.forget(id);
    // Cancelling the password shows the recent list; the next start does not ask again.
    if (restoring && opened.status !== 'opening') {
      await writeSetting(repository, 'activeDocumentId', null);
    }
  }
}

/** Deletes a saved document from the recent list, record and bytes together. */
export async function deleteSaved(id: string): Promise<void> {
  const repository = useStorageStore.getState().repository;
  if (!repository) return;
  if (useDocumentStore.getState().id === id) await closeDocument();
  await deleteDocuments(repository, [id]);
}

/**
 * Clear everything (S7): saving stops, then the database is deleted fail-closed. Resolves true
 * once the browser confirmed the deletion and `reload` has been called; false if it did not
 * confirm, in which case nothing on screen changes and nothing more is saved.
 */
export async function clearEverything(
  reload: () => void = () => window.location.reload(),
): Promise<boolean> {
  const repository = useStorageStore.getState().repository;
  useSessionStore.getState().update({ saving: false });
  controller?.stop();
  if (!repository) return false;
  try {
    await repository.clearEverything();
  } catch (error) {
    console.error('Clear everything was not confirmed', error);
    return false;
  }
  reload();
  return true;
}
