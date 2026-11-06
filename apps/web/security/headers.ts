// The production response headers (spec §11.3), defined once in headers.json so that the preview
// server, the E2E suite and the CloudFront response headers policy (infra/bogey.yaml) all use the same set.
import production from './headers.json' with { type: 'json' };

export type HeaderSet = Readonly<Record<string, string>>;

/** Served in production (HTTPS, CloudFront), unchanged. */
export const productionHeaders: HeaderSet = production;

const isTransportOnly = (directive: string) => /^upgrade-insecure-requests\b/.test(directive);

/**
 * The production set minus what only applies over HTTPS, for local plain-HTTP servers. Safari
 * applies `upgrade-insecure-requests` to localhost, so the page would request its own scripts
 * over https:// and render blank; browsers ignore HSTS over HTTP anyway.
 */
function withoutTransportUpgrades(headers: HeaderSet): Record<string, string> {
  const rest = Object.entries(headers).filter(([name]) => name !== 'Strict-Transport-Security');
  const csp = headers['Content-Security-Policy']!.split(';')
    .map((directive) => directive.trim())
    .filter((directive) => !isTransportOnly(directive))
    .join('; ');
  return { ...Object.fromEntries(rest), 'Content-Security-Policy': csp };
}

/** Served by `vite preview` (and so the E2E suite): production with no other change. */
export const previewHeaders: HeaderSet = withoutTransportUpgrades(productionHeaders);

/**
 * The dev server's relaxed set, derived from the production one. Vite's dev client needs an inline
 * React Refresh preamble, a WebSocket for HMR and innerHTML for its error overlay, so the dev CSP
 * adds those and drops Trusted Types. It is applied only by `vite` (dev), never by `vite preview`.
 */
export function devHeaders(): HeaderSet {
  const csp = previewHeaders['Content-Security-Policy']!.split(';')
    .map((directive) => directive.trim())
    .filter((directive) => !/^(require-trusted-types-for|trusted-types)\b/.test(directive))
    .map((directive) => {
      if (directive.startsWith('script-src ')) return `${directive} 'unsafe-inline'`;
      if (directive.startsWith('style-src ')) return `${directive} 'unsafe-inline'`;
      if (directive.startsWith('connect-src ')) return "connect-src 'self' ws: wss:";
      return directive;
    })
    .join('; ');
  return { ...previewHeaders, 'Content-Security-Policy': csp };
}
