// Builds src/sw/sw.ts to an unhashed /sw.js with the precache manifest injected (spec §11.5).
//
// It runs after every other plugin has emitted its files (the app chunks, both workers, the fonts,
// index.html and pdf.js's data under /pdfjs/), lists what to precache with precachePaths(), names
// the cache from the build id and a digest of the cached bytes, and compiles the worker as one
// classic script with the manifest defined as a constant. Dev serves no worker: registration
// happens only in production builds (src/main.tsx).
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type Rolldown } from 'vite';
import { cacheName, precachePaths, type PrecacheManifest } from '../src/sw/manifest.ts';

const ENTRY = fileURLToPath(new URL('../src/sw/sw.ts', import.meta.url));
export const SW_FILE = 'sw.js';

type Bundle = Rolldown.OutputBundle;

/** A digest of every precached file's path and bytes, so any change makes a new cache. */
export function bundleDigest(bundle: Bundle, paths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const path of paths) {
    const file = bundle[path.slice(1)];
    if (!file) continue;
    hash.update(path).update('\0');
    hash.update(file.type === 'chunk' ? file.code : file.source).update('\0');
  }
  return hash.digest('hex');
}

/** Compiles the worker as a single minified classic script with the manifest inlined. */
export async function compileWorker(manifest: PrecacheManifest): Promise<string> {
  const result = await build({
    configFile: false,
    envDir: false,
    publicDir: false,
    logLevel: 'warn',
    define: { __BOGEY_SW__: JSON.stringify(manifest) },
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      copyPublicDir: false,
      emptyOutDir: false,
      rolldownOptions: {
        input: ENTRY,
        output: { format: 'iife', entryFileNames: SW_FILE, codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunk = outputs
    .flatMap((output) => output.output)
    .find((file): file is Rolldown.OutputChunk => file.type === 'chunk' && file.isEntry);
  if (!chunk) throw new Error('bogey:service-worker: the worker build produced no entry chunk');
  return chunk.code;
}

export function serviceWorkerPlugin(build = process.env.VITE_BOGEY_BUILD ?? 'dev'): Plugin {
  return {
    name: 'bogey:service-worker',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      if (!bundle['index.html']) {
        this.error('bogey:service-worker: index.html is not in the bundle yet');
      }
      const paths = precachePaths(Object.keys(bundle));
      const manifest: PrecacheManifest = {
        cache: cacheName(build, bundleDigest(bundle, paths)),
        paths,
      };
      this.emitFile({ type: 'asset', fileName: SW_FILE, source: await compileWorker(manifest) });
    },
  };
}
