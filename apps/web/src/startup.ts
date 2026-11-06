// Start-up work that must happen before the UI renders (spec §11.2, §11.3, §10.5).
import { installDropGuard } from './security/dropGuard.ts';
import { installTrustedTypesPolicy, type TrustedTypesLike } from './security/trustedTypes.ts';
import { openRepository, type OpenOptions } from './state/persistence.ts';
import { useStorageStore } from './state/storage.ts';

export interface StartupHost {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'> & {
    trustedTypes?: TrustedTypesLike;
    location: { origin: string };
  };
  storage?: OpenOptions;
}

/** Installs the security guards synchronously, then opens storage. */
export function startup(host: StartupHost): Promise<void> {
  installTrustedTypesPolicy(host.window.trustedTypes, host.window.location.origin);
  installDropGuard(host.window);
  return openRepository(host.storage).then((repository) => {
    useStorageStore.getState().attach(repository);
  });
}
