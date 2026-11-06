import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { ports } from '../../scripts/ports.mjs';
import { pdfjsAssetsPlugin } from './plugins/pdfjsAssets.ts';
import { serviceWorkerPlugin } from './plugins/serviceWorker.ts';
import { devHeaders, previewHeaders } from './security/headers.ts';

// Vite's static handler answers a revalidation with a bare 304 that carries none of
// `preview.headers`, and WebKit then blocks workers under COEP. Setting the headers before any
// handler runs puts them on every response, 304s included (spec §11.3).
const previewHeadersOnEveryResponse = (): Plugin => ({
  name: 'bogey:preview-headers',
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      for (const [name, value] of Object.entries(previewHeaders)) res.setHeader(name, value);
      next();
    });
  },
});

const { dev, preview } = ports();

export default defineConfig({
  plugins: [react(), previewHeadersOnEveryResponse(), pdfjsAssetsPlugin(), serviceWorkerPlugin()],
  define: {
    // The commit being built (scripts/deploy.sh); the About page shows it (spec §11.7).
    __BOGEY_BUILD__: JSON.stringify(process.env.VITE_BOGEY_BUILD ?? 'dev'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // Module workers, so the pdf worker shares chunks with the app (spec §10.1).
  worker: { format: 'es' },
  // Dev only: a relaxed CSP for HMR. The preview server (and so the E2E suite) applies the
  // production header set minus the HTTPS-only upgrades, since it serves plain HTTP (spec §11.3).
  server: { port: dev, headers: devHeaders() },
  preview: { port: preview, strictPort: true, headers: previewHeaders },
});
