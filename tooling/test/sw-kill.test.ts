// The service worker kill switch (spec §11.5): run against a fake service-worker scope, it
// activates at once, deletes every cache and unregisters itself.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { KILL_SWITCH_SOURCE, writeKillSwitch } from '../../scripts/sw-kill.ts';

type Listener = (event: { waitUntil(promise: Promise<unknown>): void }) => void;

describe('scripts/sw-kill.ts', () => {
  it('skips waiting, deletes every cache and unregisters, with no fetch handler', async () => {
    const listeners = new Map<string, Listener>();
    const names = new Set(['bogey-abc-123', 'bogey-old-456']);
    const scope = {
      skipWaiting: vi.fn(),
      registration: { unregister: vi.fn(() => Promise.resolve(true)) },
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    };
    const caches = {
      keys: () => Promise.resolve([...names]),
      delete: (name: string) => Promise.resolve(names.delete(name)),
    };
    new Function('self', 'caches', KILL_SWITCH_SOURCE)(scope, caches);
    expect([...listeners.keys()].sort()).toEqual(['activate', 'install']);

    const pending: Promise<unknown>[] = [];
    const event = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    listeners.get('install')!(event);
    expect(scope.skipWaiting).toHaveBeenCalled();
    listeners.get('activate')!(event);
    await Promise.all(pending);
    expect(names.size).toBe(0);
    expect(scope.registration.unregister).toHaveBeenCalled();
  });

  it('writes the script to the given path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bogey-sw-kill-'));
    try {
      writeKillSwitch(join(dir, 'sw.js'));
      expect(readFileSync(join(dir, 'sw.js'), 'utf8')).toBe(KILL_SWITCH_SOURCE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
