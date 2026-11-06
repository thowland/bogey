// Trusted Types default policy (spec §11.3). The CSP requires Trusted Types for every script sink.
// Bogey's only script-URL sinks are its two workers and the service worker registration, so the
// default policy converts exactly those same-origin URLs and nothing else; HTML and script
// conversions are not defined, so innerHTML-style sinks keep throwing.

/**
 * Same-origin paths Bogey loads as scripts: the pdf.js worker and the core pdf worker as hashed
 * production chunks or dev modules, and /sw.js.
 */
const SCRIPT_PATHS = [
  /^\/assets\/pdf\.worker(\.min)?-[\w-]+\.(m?js)$/,
  /^\/src\/workers\/pdf\.worker\.ts$/,
  /^\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?pdfjs-dist\/build\/pdf\.worker(\.min)?\.mjs$/,
  /^\/sw\.js$/,
];

export interface TrustedTypesLike {
  createPolicy(name: string, rules: { createScriptURL: (input: string) => string | null }): unknown;
}

export function allowedScriptUrl(input: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.search !== '' || url.hash !== '') return null;
  return SCRIPT_PATHS.some((path) => path.test(url.pathname)) ? url.href : null;
}

/** Installs the policy where Trusted Types exist; returns whether it was installed. */
export function installTrustedTypesPolicy(
  trustedTypes: TrustedTypesLike | undefined,
  origin: string,
): boolean {
  if (!trustedTypes) return false;
  trustedTypes.createPolicy('default', {
    createScriptURL: (input) => allowedScriptUrl(input, origin),
  });
  return true;
}
