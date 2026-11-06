// What the service worker caches and how it answers each request (spec §11.5). Pure functions,
// shared by the Vite plugin that builds /sw.js (plugins/serviceWorker.ts) and by sw.ts itself.

/** The one command the page may send the worker: activate the waiting version (B7). */
export const SKIP_WAITING = 'skipWaiting';

/** The document served for every navigation. */
export const SHELL = '/index.html';

/** pdf.js data that is precached: every document may need the fonts, decoders and ICC profile. */
const PRECACHED_PDFJS = ['pdfjs/standard_fonts/', 'pdfjs/wasm/', 'pdfjs/iccs/'];

/** CMaps (about 1.5 MB, CJK documents only) are cached on first use instead (spec §16). */
export const RUNTIME_PREFIX = '/pdfjs/cmaps/';

/** What the worker carries: its cache name and the paths it precaches. */
export interface PrecacheManifest {
  cache: string;
  paths: string[];
}

/**
 * The paths to precache, from the build's file names (relative, e.g. `assets/index-abc.js`):
 * index.html, every hashed asset except source maps (the scripts, both workers, the CSS and the
 * fonts), and the precached pdf.js directories without their licence texts. Sorted, `/`-rooted.
 */
export function precachePaths(fileNames: Iterable<string>): string[] {
  const paths = new Set<string>([SHELL]);
  for (const name of fileNames) {
    const base = name.slice(name.lastIndexOf('/') + 1);
    const asset = name.startsWith('assets/') && !name.endsWith('.map');
    const pdfjs = PRECACHED_PDFJS.some((dir) => name.startsWith(dir)) && !/^LICENSE/.test(base);
    if (asset || pdfjs) paths.add(`/${name}`);
  }
  return [...paths].sort();
}

/**
 * The cache name: the build id plus a digest of what is cached, so two builds never share a cache
 * even when both are local builds with the default id. Only characters safe in a name are kept.
 */
export function cacheName(build: string, digest: string): string {
  const clean = (text: string) => text.replace(/[^\w.-]/g, '').slice(0, 40) || 'none';
  return `bogey-${clean(build)}-${clean(digest).slice(0, 12)}`;
}

export interface RequestLike {
  method: string;
  mode: string;
  url: string;
}

export type Route =
  | { kind: 'shell' }
  | { kind: 'precache'; key: string }
  | { kind: 'runtime'; key: string }
  | { kind: 'pass' };

/**
 * How the worker answers a request. Only same-origin GETs are touched: navigations get the cached
 * shell, precached paths and CMaps come from the cache first. Anything with a query string, any
 * other method, any other origin and any path not in the manifest goes to the network untouched.
 */
export function route(request: RequestLike, origin: string, precached: ReadonlySet<string>): Route {
  if (request.method !== 'GET') return { kind: 'pass' };
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { kind: 'pass' };
  }
  if (url.origin !== origin) return { kind: 'pass' };
  if (request.mode === 'navigate') return { kind: 'shell' };
  if (url.search !== '') return { kind: 'pass' };
  if (precached.has(url.pathname)) return { kind: 'precache', key: url.pathname };
  if (url.pathname.startsWith(RUNTIME_PREFIX) && !url.pathname.includes('..')) {
    return { kind: 'runtime', key: url.pathname };
  }
  return { kind: 'pass' };
}

/** Only cache whole, successful same-origin responses. */
export function cacheable(response: { ok: boolean; status: number; type: string }): boolean {
  return response.ok && response.status === 200 && response.type === 'basic';
}
