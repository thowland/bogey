// The service worker (spec §11.5, S8, B7), built to an unhashed /sw.js by
// plugins/serviceWorker.ts, which injects the precache manifest as __BOGEY_SW__.
//
// - Install precaches the manifest into a cache named for the build.
// - Activate deletes every other cache and takes control of open pages, so the first visit is
//   ready for offline use without a reload.
// - Fetch answers same-origin GETs: navigations with the cached index.html, precached paths from
//   the cache first, /pdfjs/cmaps/ cached on first use. Everything else passes through untouched.
// - The only message it acts on is the page's skipWaiting command (the update toast).
//
// It does not touch IndexedDB and imports no scripts. Its decisions live in manifest.ts, which is
// unit-tested; this file is the event wiring, exercised by e2e/offline.spec.ts and excluded from
// coverage (implementation plan §1.3).
import { SHELL, SKIP_WAITING, cacheable, route, type PrecacheManifest } from './manifest.ts';

declare const __BOGEY_SW__: PrecacheManifest;

// The app compiles against the DOM library, so the few service-worker types used here are
// declared locally rather than pulling in the conflicting WebWorker library.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface ExtendableMessageEvent extends ExtendableEvent {
  readonly data: unknown;
}
interface ServiceWorkerScope {
  readonly location: Location;
  readonly registration: ServiceWorkerRegistration;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: ExtendableMessageEvent) => void): void;
}

const scope = self as unknown as ServiceWorkerScope;
const { cache: CACHE, paths: PRECACHE } = __BOGEY_SW__;
const PRECACHED: ReadonlySet<string> = new Set(PRECACHE);

scope.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, so an unhashed file (index.html, /pdfjs/) is never cached
  // from a stale copy of the previous build.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' }))),
      ),
  );
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => scope.clients.claim()),
  );
});

async function cached(key: string, request: Request): Promise<Response> {
  const hit = await caches.match(key, { cacheName: CACHE });
  return hit ?? fetch(request);
}

async function cachedOnFirstUse(key: string, request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(key, response.clone());
  return response;
}

scope.addEventListener('fetch', (event) => {
  const { request } = event;
  const decision = route(request, scope.location.origin, PRECACHED);
  switch (decision.kind) {
    case 'shell':
      event.respondWith(cached(SHELL, request));
      return;
    case 'precache':
      event.respondWith(cached(decision.key, request));
      return;
    case 'runtime':
      event.respondWith(cachedOnFirstUse(decision.key, request));
      return;
    case 'pass':
      return;
  }
});

// Messages reach a service worker only from same-origin pages it controls, and this one acts on
// a single exact command (spec §11.5). The lint rule against `message` listeners targets windows.
// eslint-disable-next-line no-restricted-syntax
scope.addEventListener('message', (event) => {
  if (event.data === SKIP_WAITING) void scope.skipWaiting();
});
