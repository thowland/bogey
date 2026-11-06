// Service worker registration and the update prompt (spec §11.5, B7). The one file allowed to
// touch `navigator.serviceWorker`.
//
// A new build's worker installs and then waits. The page offers "A new version is ready. Reload to
// update." On click it posts skipWaiting to the waiting worker; the worker activates and takes
// control, and every page it controlled reloads on `controllerchange`. Edits in progress are
// already saved (spec §10.5), so the reload loses nothing. No `message` listener is added here.
import { UPDATE_PROMPT } from '../ui/messages.ts';
import { useToastStore } from '../ui/Toast.tsx';
import { SKIP_WAITING } from './manifest.ts';

type Listener = () => void;

export interface WorkerLike {
  readonly state: string;
  postMessage(message: string): void;
  addEventListener(type: 'statechange', listener: Listener): void;
}

export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: Listener): void;
}

export interface ContainerLike {
  readonly controller: unknown;
  register(url: string, options: RegistrationOptions): Promise<RegistrationLike>;
  addEventListener(type: 'controllerchange', listener: Listener, options?: { once: boolean }): void;
}

export interface UpdateHost {
  /** `navigator.serviceWorker`, absent outside secure contexts and in some private modes. */
  container: ContainerLike | undefined;
  reload(): void;
  /** Shows the update prompt; `accept` runs when the user chooses to reload. */
  offer(accept: () => void): void;
  warn(message: string, error: unknown): void;
}

/**
 * Registers /sw.js and wires the update prompt. Resolves once registration settles; failures are
 * logged, never shown, since the app works without the worker (it just is not offline-ready).
 */
export async function registerServiceWorker(host: UpdateHost): Promise<void> {
  const { container } = host;
  if (!container) return;

  // A page that was already controlled when it loaded reloads when control passes to a new
  // version, whichever tab accepted the update, so no tab keeps running code whose files the new
  // version no longer caches. The first install takes control of a page that had none, and that
  // must not reload it.
  let reloading = false;
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    host.reload();
  };
  if (container.controller) container.addEventListener('controllerchange', reloadOnce);

  let registration: RegistrationLike;
  try {
    // `updateViaCache: 'none'`: the browser checks /sw.js against the network on every navigation.
    registration = await container.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  } catch (error) {
    host.warn('Service worker registration failed; offline use is unavailable.', error);
    return;
  }

  let offered: WorkerLike | null = null;
  const offerWaiting = () => {
    const waiting = registration.waiting;
    // Without a controller this is the first install, which activates by itself.
    if (!waiting || waiting === offered || !container.controller) return;
    offered = waiting;
    host.offer(() => {
      container.addEventListener('controllerchange', reloadOnce, { once: true });
      waiting.postMessage(SKIP_WAITING);
    });
  };

  offerWaiting();
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') offerWaiting();
    });
  });
}

/** The browser host: the real container, a page reload and the toast (main.tsx). */
export function startServiceWorker(enabled: boolean): Promise<void> {
  if (!enabled || !('serviceWorker' in navigator)) return Promise.resolve();
  return registerServiceWorker({
    container: navigator.serviceWorker,
    reload: () => location.reload(),
    offer: (accept) => {
      useToastStore
        .getState()
        .show(UPDATE_PROMPT.text, { label: UPDATE_PROMPT.action, run: accept });
    },
    warn: (message, error) => console.warn(message, error),
  });
}
