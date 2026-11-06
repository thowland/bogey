// Copies pdf.js's data files into the build at /pdfjs/ and serves them from node_modules in dev
// and Vitest browser mode (spec §10.3). These are the standard fonts, the CMaps, the WASM
// decoders with their JavaScript fallbacks, and the CMYK ICC profile. The QuickJS scripting
// sandbox is left out, because Bogey never enables pdf.js scripting (spec §11.4).
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import type { Connect, Plugin } from 'vite';

export const PDFJS_DIRECTORIES = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;

/** QuickJS is the scripting sandbox; nothing in Bogey loads it. */
const EXCLUDED = /quickjs/i;

const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
};

export interface PdfjsAsset {
  /** Path in the build, e.g. `pdfjs/wasm/openjpeg.wasm`. */
  fileName: string;
  /** Absolute path in node_modules. */
  source: string;
}

export function pdfjsRoot(): string {
  return dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
}

/** Every file the build publishes under /pdfjs/, sorted. */
export function pdfjsAssets(root: string = pdfjsRoot()): PdfjsAsset[] {
  return PDFJS_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(root, directory))
      .filter((name) => !EXCLUDED.test(name))
      .sort()
      .map((name) => ({
        fileName: `pdfjs/${directory}/${name}`,
        source: join(root, directory, name),
      })),
  );
}

function middleware(assets: readonly PdfjsAsset[]): Connect.NextHandleFunction {
  const byUrl = new Map(assets.map((asset) => [`/${asset.fileName}`, asset.source]));
  return (req, res, next) => {
    const source = byUrl.get((req.url ?? '').split('?')[0]!);
    if (!source) return next();
    res.setHeader('Content-Type', CONTENT_TYPES[extname(source)] ?? 'application/octet-stream');
    res.end(readFileSync(source));
  };
}

export function pdfjsAssetsPlugin(): Plugin {
  const assets = pdfjsAssets();
  return {
    name: 'bogey:pdfjs-assets',
    configureServer(server) {
      server.middlewares.use(middleware(assets));
    },
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: 'asset',
          fileName: asset.fileName,
          source: readFileSync(asset.source),
        });
      }
    },
  };
}
