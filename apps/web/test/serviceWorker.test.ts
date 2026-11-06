// @vitest-environment node
// The Vite plugin that builds /sw.js (spec §11.5), and the built worker itself, run against a fake
// service-worker scope: install precaches the manifest, activate deletes other caches, fetch
// answers from the cache, and only the skipWaiting message does anything.
import { describe, expect, it, vi } from 'vitest';
import { bundleDigest, compileWorker, serviceWorkerPlugin } from '../plugins/serviceWorker.ts';
import { SKIP_WAITING } from '../src/sw/manifest.ts';

const ORIGIN = 'https://bogey.example';

/** Caches keyed by URL, enough of the Cache Storage API for the worker. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (input: RequestInfo | URL) =>
    new URL(input instanceof Request ? input.url : String(input), ORIGIN).href;
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return Promise.resolve({
      addAll: async (requests: Request[]) => {
        for (const request of requests) store.set(keyOf(request), await network(request));
      },
      match: (key: RequestInfo) => Promise.resolve(store.get(keyOf(key))?.clone()),
      put: (key: RequestInfo, response: Response) => {
        store.set(keyOf(key), response);
        return Promise.resolve();
      },
    });
  };
  const network = vi.fn((request: Request | string) => {
    const url = typeof request === 'string' ? request : request.url;
    const response = new Response(`network ${new URL(url, ORIGIN).pathname}`, { status: 200 });
    Object.defineProperty(response, 'type', { value: 'basic' });
    return Promise.resolve(response);
  });
  const caches = {
    open,
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    match: (key: RequestInfo, options: { cacheName: string }) =>
      Promise.resolve(stores.get(options.cacheName)?.get(keyOf(key))?.clone()),
  };
  return { caches, stores, network };
}

type Listener = (event: Record<string, unknown>) => void;

/** Runs the built worker in a fake scope and returns a way to dispatch its events. */
function runWorker(code: string) {
  const listeners = new Map<string, Listener[]>();
  const { caches, stores, network } = fakeCaches();
  const scope = {
    location: new URL(`${ORIGIN}/sw.js`),
    clients: { claim: vi.fn(() => Promise.resolve()) },
    skipWaiting: vi.fn(() => Promise.resolve()),
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  // Relative URLs resolve against the worker's origin, as they do in a real worker.
  class ScopedRequest extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, ORIGIN), init);
    }
  }
  new Function('self', 'caches', 'fetch', 'Request', code)(scope, caches, network, ScopedRequest);
  const extendable = async (type: string, extra: Record<string, unknown> = {}) => {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    for (const listener of listeners.get(type) ?? []) {
      listener({
        ...extra,
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
        respondWith: (promise: Promise<Response>) => (response = promise),
      });
    }
    await Promise.all(pending);
    return response;
  };
  const fetchEvent = (url: string, init: { method?: string; mode?: string } = {}) => {
    const request = new Request(new URL(url, ORIGIN), { method: init.method ?? 'GET' });
    Object.defineProperty(request, 'mode', { value: init.mode ?? 'cors' });
    return extendable('fetch', { request });
  };
  return { scope, stores, network, extendable, fetchEvent };
}

const manifest = {
  cache: 'bogey-test-0001',
  paths: ['/index.html', '/assets/index-abc.js', '/pdfjs/wasm/openjpeg.wasm'],
};

describe('the built service worker', () => {
  it('compiles to one classic script with the manifest inlined', async () => {
    const code = await compileWorker(manifest);
    expect(code).not.toMatch(/^\s*(import|export)\b/m);
    expect(code).not.toContain('importScripts');
    expect(code).toContain('bogey-test-0001');
  });

  it('precaches on install, deletes other caches and claims pages on activate', async () => {
    const sw = runWorker(await compileWorker(manifest));
    sw.stores.set('bogey-old', new Map());
    sw.stores.set('unrelated', new Map());
    await sw.extendable('install');
    expect([...sw.stores.get(manifest.cache)!.keys()]).toEqual(
      manifest.paths.map((path) => `${ORIGIN}${path}`),
    );
    const precacheRequest = sw.network.mock.calls[0]![0] as Request;
    expect(precacheRequest.cache).toBe('reload');
    await sw.extendable('activate');
    expect([...sw.stores.keys()]).toEqual([manifest.cache]);
    expect(sw.scope.clients.claim).toHaveBeenCalled();
  });

  it('answers navigations with the cached shell and precached paths from the cache', async () => {
    const sw = runWorker(await compileWorker(manifest));
    await sw.extendable('install');
    sw.network.mockClear();
    const shell = await sw.fetchEvent('/?open=https://evil.example/x.pdf', { mode: 'navigate' });
    expect(await shell!.text()).toBe('network /index.html');
    const script = await sw.fetchEvent('/assets/index-abc.js');
    expect(await script!.text()).toBe('network /assets/index-abc.js');
    expect(sw.network).not.toHaveBeenCalled();
  });

  it('caches CMaps on first use and falls back to the network for a missing entry', async () => {
    const sw = runWorker(await compileWorker(manifest));
    await sw.extendable('activate');
    const first = await sw.fetchEvent('/pdfjs/cmaps/UniJIS-UTF8-H.bcmap');
    expect(await first!.text()).toBe('network /pdfjs/cmaps/UniJIS-UTF8-H.bcmap');
    expect(sw.network).toHaveBeenCalledTimes(1);
    await sw.fetchEvent('/pdfjs/cmaps/UniJIS-UTF8-H.bcmap');
    expect(sw.network).toHaveBeenCalledTimes(1);
    // Nothing installed: a precached path goes to the network.
    await sw.fetchEvent('/assets/index-abc.js');
    expect(sw.network).toHaveBeenCalledTimes(2);
  });

  it('leaves other requests to the network untouched', async () => {
    const sw = runWorker(await compileWorker(manifest));
    expect(await sw.fetchEvent('/', { method: 'POST' })).toBeUndefined();
    expect(await sw.fetchEvent('https://evil.example/assets/index-abc.js')).toBeUndefined();
    expect(await sw.fetchEvent('/assets/unknown.js')).toBeUndefined();
  });

  it('acts on the skipWaiting command and nothing else', async () => {
    const sw = runWorker(await compileWorker(manifest));
    for (const data of ['skip', { skipWaiting: true }, null, 'SKIPWAITING']) {
      await sw.extendable('message', { data });
    }
    expect(sw.scope.skipWaiting).not.toHaveBeenCalled();
    await sw.extendable('message', { data: SKIP_WAITING });
    expect(sw.scope.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('the service worker plugin', () => {
  const bundle = {
    'index.html': { type: 'asset', fileName: 'index.html', source: '<html></html>' },
    'assets/index-abc.js': { type: 'chunk', fileName: 'assets/index-abc.js', code: 'app()' },
    'assets/index-abc.js.map': { type: 'asset', fileName: 'assets/index-abc.js.map', source: '{}' },
    'pdfjs/wasm/openjpeg.wasm': {
      type: 'asset',
      fileName: 'pdfjs/wasm/openjpeg.wasm',
      source: new Uint8Array([0, 97, 115, 109]),
    },
  } as never;

  it('digests paths and bytes, so any change to a cached file changes the digest', () => {
    const paths = ['/index.html', '/assets/index-abc.js', '/missing.js'];
    const digest = bundleDigest(bundle, paths);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const changed = {
      ...(bundle as object),
      'index.html': { type: 'asset', fileName: 'index.html', source: '<html>2</html>' },
    } as never;
    expect(bundleDigest(changed, paths)).not.toBe(digest);
  });

  it('emits sw.js with the manifest for the build after the rest of the bundle', async () => {
    const plugin = serviceWorkerPlugin('abc123');
    expect(plugin).toMatchObject({ apply: 'build', enforce: 'post' });
    const emitFile = vi.fn();
    const error = vi.fn((message: string) => {
      throw new Error(message);
    });
    const hook = plugin.generateBundle as unknown as (
      this: unknown,
      options: unknown,
      bundle: unknown,
    ) => Promise<void>;
    await hook.call({ emitFile, error }, {}, bundle);
    const [{ fileName, source }] = emitFile.mock.calls[0]! as [
      { fileName: string; source: string },
    ];
    expect(fileName).toBe('sw.js');
    expect(source).toMatch(/bogey-abc123-[0-9a-f]{12}/);
    expect(source).toContain('/pdfjs/wasm/openjpeg.wasm');
    expect(source).not.toContain('index-abc.js.map');

    await expect(hook.call({ emitFile, error }, {}, {})).rejects.toThrow(/index\.html/);
  });
});
