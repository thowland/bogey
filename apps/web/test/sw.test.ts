// The service worker's pure decisions (spec §11.5) and the page side of registration and updates
// (B7). The worker's event wiring is tested by running the built script in serviceWorker.test.ts.
import { describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_PREFIX,
  SHELL,
  SKIP_WAITING,
  cacheName,
  cacheable,
  precachePaths,
  route,
} from '../src/sw/manifest.ts';
import {
  registerServiceWorker,
  startServiceWorker,
  type ContainerLike,
  type RegistrationLike,
  type UpdateHost,
  type WorkerLike,
} from '../src/sw/register.ts';
import { UPDATE_PROMPT } from '../src/ui/messages.ts';
import { useToastStore } from '../src/ui/Toast.tsx';

describe('precache manifest', () => {
  const build = [
    'index.html',
    'sw.js',
    'assets/index-abc.js',
    'assets/index-abc.js.map',
    'assets/index-def.css',
    'assets/loader-123.js',
    'assets/pdf.worker-xyz.js',
    'assets/pdf.worker.min-uvw.js',
    'assets/LiberationSans-Regular-q1.woff2',
    'pdfjs/standard_fonts/FoxitSerif.pfb',
    'pdfjs/standard_fonts/LICENSE_FOXIT',
    'pdfjs/wasm/openjpeg.wasm',
    'pdfjs/wasm/LICENSE_OPENJPEG',
    'pdfjs/iccs/CGATS001Compat-v2-micro.icc',
    'pdfjs/cmaps/UniJIS-UTF8-H.bcmap',
  ];

  it('lists index.html, hashed assets, both workers, fonts and the precached pdf.js data', () => {
    expect(precachePaths(build)).toEqual([
      '/assets/LiberationSans-Regular-q1.woff2',
      '/assets/index-abc.js',
      '/assets/index-def.css',
      '/assets/loader-123.js',
      '/assets/pdf.worker-xyz.js',
      '/assets/pdf.worker.min-uvw.js',
      '/index.html',
      '/pdfjs/iccs/CGATS001Compat-v2-micro.icc',
      '/pdfjs/standard_fonts/FoxitSerif.pfb',
      '/pdfjs/wasm/openjpeg.wasm',
    ]);
  });

  it('always includes the shell and never the worker itself, source maps, licences or CMaps', () => {
    const paths = precachePaths([]);
    expect(paths).toEqual([SHELL]);
    const full = precachePaths(build);
    for (const left of ['/sw.js', '/assets/index-abc.js.map', '/pdfjs/wasm/LICENSE_OPENJPEG']) {
      expect(full).not.toContain(left);
    }
    expect(full.some((path) => path.startsWith(RUNTIME_PREFIX))).toBe(false);
  });

  it('names the cache after the build and a digest, keeping only safe characters', () => {
    expect(cacheName('0a1b2c3d4e5f', 'ffeeddccbbaa99887766')).toBe(
      'bogey-0a1b2c3d4e5f-ffeeddccbbaa',
    );
    expect(cacheName('abc-dirty', '12')).toBe('bogey-abc-dirty-12');
    expect(cacheName('<script>/x y', '')).toBe('bogey-scriptxy-none');
    expect(cacheName('dev', 'a')).not.toBe(cacheName('dev', 'b'));
  });

  it('caches only whole, successful same-origin responses', () => {
    expect(cacheable({ ok: true, status: 200, type: 'basic' })).toBe(true);
    expect(cacheable({ ok: true, status: 206, type: 'basic' })).toBe(false);
    expect(cacheable({ ok: false, status: 404, type: 'basic' })).toBe(false);
    expect(cacheable({ ok: false, status: 0, type: 'opaque' })).toBe(false);
  });
});

describe('request routing', () => {
  const origin = 'https://bogey.example';
  const precached = new Set(['/index.html', '/assets/index-abc.js']);
  const get = (url: string, mode = 'cors') =>
    route({ method: 'GET', mode, url }, origin, precached);

  it('serves the shell for every same-origin navigation, whatever its path or query', () => {
    for (const path of [
      '/',
      '/?open=https://evil.example/x.pdf',
      '/anything#doc=1',
      '/index.html',
    ]) {
      expect(get(`${origin}${path}`, 'navigate')).toEqual({ kind: 'shell' });
    }
  });

  it('answers precached paths and CMaps from the cache', () => {
    expect(get(`${origin}/assets/index-abc.js`)).toEqual({
      kind: 'precache',
      key: '/assets/index-abc.js',
    });
    expect(get(`${origin}/pdfjs/cmaps/UniJIS-UTF8-H.bcmap`)).toEqual({
      kind: 'runtime',
      key: '/pdfjs/cmaps/UniJIS-UTF8-H.bcmap',
    });
  });

  it('passes through other methods, origins, queries, unknown paths and bad URLs', () => {
    expect(route({ method: 'POST', mode: 'cors', url: `${origin}/` }, origin, precached)).toEqual({
      kind: 'pass',
    });
    expect(route({ method: 'HEAD', mode: 'cors', url: `${origin}/` }, origin, precached)).toEqual({
      kind: 'pass',
    });
    for (const url of [
      'https://evil.example/assets/index-abc.js',
      'https://evil.example/',
      `${origin}/assets/index-abc.js?v=2`,
      `${origin}/assets/other.js`,
      `${origin}/sw.js`,
      'not a url',
    ]) {
      expect(get(url), url).toEqual({ kind: 'pass' });
    }
    expect(get('https://evil.example/', 'navigate')).toEqual({ kind: 'pass' });
  });
});

/** A fake ServiceWorkerContainer with workers whose events the test fires. */
function fakes(options: { controlled?: boolean; register?: () => Promise<RegistrationLike> } = {}) {
  const worker = (state = 'installed') => {
    const listeners: (() => void)[] = [];
    const w = {
      state,
      postMessage: vi.fn(),
      addEventListener: (_type: 'statechange', listener: () => void) => listeners.push(listener),
      become(next: string) {
        w.state = next;
        for (const listener of listeners) listener();
      },
    };
    return w;
  };
  const updateListeners: (() => void)[] = [];
  const registration = {
    installing: null as WorkerLike | null,
    waiting: null as WorkerLike | null,
    addEventListener: (_type: 'updatefound', listener: () => void) =>
      updateListeners.push(listener),
    updatefound() {
      for (const listener of updateListeners) listener();
    },
  };
  const controllerListeners: { listener: () => void; once: boolean }[] = [];
  const container = {
    controller: options.controlled === false ? null : ({} as unknown),
    register: vi.fn(options.register ?? (() => Promise.resolve(registration))),
    addEventListener: (_type: 'controllerchange', listener: () => void, opts?: { once: boolean }) =>
      controllerListeners.push({ listener, once: opts?.once ?? false }),
    controllerchange() {
      for (const { listener } of [...controllerListeners]) listener();
    },
  };
  const offers: (() => void)[] = [];
  const host = {
    container: container as ContainerLike,
    reload: vi.fn<() => void>(),
    offer: (accept: () => void) => void offers.push(accept),
    warn: vi.fn<(message: string, error: unknown) => void>(),
  } satisfies UpdateHost;
  return { worker, registration, container, host, offers };
}

describe('registration and updates (B7)', () => {
  it('registers /sw.js for the whole origin, always checking the network for updates', async () => {
    const { container, host, offers } = fakes();
    await registerServiceWorker(host);
    expect(container.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    expect(offers).toHaveLength(0);
  });

  it('does nothing without a service worker container', async () => {
    const { host } = fakes();
    await expect(registerServiceWorker({ ...host, container: undefined })).resolves.toBeUndefined();
  });

  it('logs a failed registration and carries on', async () => {
    const { host } = fakes({ register: () => Promise.reject(new Error('blocked')) });
    await registerServiceWorker(host);
    expect(host.warn).toHaveBeenCalledWith(expect.stringContaining('offline'), expect.any(Error));
  });

  it('offers a worker that is already waiting, once, and accepting sends skipWaiting', async () => {
    const { worker, registration, container, host, offers } = fakes({ controlled: true });
    const waiting = worker();
    registration.waiting = waiting;
    await registerServiceWorker(host);
    expect(offers).toHaveLength(1);
    offers[0]!();
    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
    expect(host.reload).not.toHaveBeenCalled();
    container.controllerchange();
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('offers a worker that finishes installing while the page is open', async () => {
    const { worker, registration, host, offers } = fakes({ controlled: true });
    await registerServiceWorker(host);
    const next = worker('installing');
    registration.installing = next;
    registration.updatefound();
    next.become('installed');
    expect(offers).toHaveLength(0); // not waiting yet in this fake
    registration.waiting = next;
    next.become('installed');
    expect(offers).toHaveLength(1);
    next.become('activated');
    expect(offers).toHaveLength(1);
  });

  it('ignores an update with no installing worker', async () => {
    const { registration, host, offers } = fakes({ controlled: true });
    await registerServiceWorker(host);
    registration.updatefound();
    expect(offers).toHaveLength(0);
  });

  it('does not offer or reload on the first install, which takes control by itself', async () => {
    const { worker, registration, container, host, offers } = fakes({ controlled: false });
    registration.waiting = worker();
    await registerServiceWorker(host);
    expect(offers).toHaveLength(0);
    container.controllerchange();
    expect(host.reload).not.toHaveBeenCalled();
  });

  it('reloads a controlled page once when another tab accepts the update', async () => {
    const { container, host } = fakes({ controlled: true });
    await registerServiceWorker(host);
    container.controllerchange();
    container.controllerchange();
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled (development builds)', async () => {
    await expect(startServiceWorker(false)).resolves.toBeUndefined();
  });

  it('in the browser, registers through navigator.serviceWorker and offers the update toast', async () => {
    const { worker, registration, container } = fakes({ controlled: true });
    const waiting = worker();
    registration.waiting = waiting;
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await startServiceWorker(true);
      const [toast] = useToastStore.getState().items;
      expect(toast?.text).toBe(UPDATE_PROMPT.text);
      expect(toast?.action?.label).toBe('Reload');
      toast!.action!.run();
      expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING);

      container.register.mockRejectedValueOnce(new Error('denied'));
      await startServiceWorker(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });

  it('does nothing in a browser without service workers', async () => {
    expect('serviceWorker' in navigator).toBe(false);
    await expect(startServiceWorker(true)).resolves.toBeUndefined();
  });
});

describe('update prompt text', () => {
  it('is the plain sentence from the spec', () => {
    expect(UPDATE_PROMPT.text).toBe('A new version is ready. Reload to update.');
  });
});
