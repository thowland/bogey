import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setPdfBridge, stubPdfBridge } from '../src/core-bridge/pdf.ts';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { useSettingsStore } from '../src/state/settings.ts';
import { useSignaturesStore } from '../src/state/signatures.ts';
import { useSnippetsStore } from '../src/state/snippets.ts';
import { useStorageStore } from '../src/state/storage.ts';
import { useViewStore } from '../src/state/view.ts';
import { useToastStore } from '../src/ui/Toast.tsx';

// Stores are module singletons; every test starts from an empty app.
afterEach(() => {
  cleanup();
  for (const store of [
    useDocumentStore,
    useEditsStore,
    useSettingsStore,
    useSignaturesStore,
    useSnippetsStore,
    useStorageStore,
    useViewStore,
    useToastStore,
  ]) {
    store.getState().reset();
  }
  setPdfBridge(stubPdfBridge);
});

// jsdom implements neither blob: URLs nor image decoding; tests only need stable URLs.
if (!('createObjectURL' in URL)) {
  let next = 0;
  Object.assign(URL, {
    createObjectURL: () => `blob:test/${(next += 1)}`,
    revokeObjectURL: () => undefined,
  });
}
