// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Tim Howland

// Checks a deployed Bogey against apps/web/security/headers.json:
//   node scripts/check-live-headers.mjs https://bogey.beta-site.us
// Every header must match exactly on the page, the main script, every worker the main script
// references, and /sw.js once it exists, and on a 304 revalidation too, since WebKit checks COEP
// against the 304 when it loads a worker (spec §11.7). Plain HTTP must redirect to HTTPS, and a
// POST must be refused (spec §11.3, T9). Exits non-zero on any mismatch.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const expected = JSON.parse(
  readFileSync(new URL('../apps/web/security/headers.json', import.meta.url), 'utf8'),
);
const site = new URL(process.argv[2] ?? 'https://bogey.beta-site.us');
const problems = [];

function get(url, headers = {}) {
  const client = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.get(url, { headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode, headers: response.headers, body }),
      );
    });
    request.on('error', reject);
    request.setTimeout(15_000, () => request.destroy(new Error(`timed out: ${url}`)));
  });
}

function checkHeaders(label, response) {
  for (const [name, value] of Object.entries(expected)) {
    const actual = response.headers[name.toLowerCase()];
    if (actual !== value) problems.push(`${label}: ${name} is ${JSON.stringify(actual)}`);
  }
}

const page = await get(new URL('/', site));
if (page.status !== 200) problems.push(`/: status ${page.status}`);
checkHeaders('/', page);

const script = page.body.match(/<script[^>]+src="([^"]+)"/)?.[1];
if (!script) problems.push('/: no module script found');
const assets = [];
if (script) {
  const main = await get(new URL(script, site));
  if (main.status !== 200) problems.push(`${script}: status ${main.status}`);
  if (!/javascript/.test(main.headers['content-type'] ?? '')) {
    problems.push(`${script}: content-type ${main.headers['content-type']}`);
  }
  if (!/immutable/.test(main.headers['cache-control'] ?? '')) {
    problems.push(`${script}: cache-control ${main.headers['cache-control']}`);
  }
  checkHeaders(script, main);
  assets.push(script);
  for (const match of main.body.matchAll(/["'`(]([^"'`()]*worker[\w.]*-[\w-]+\.m?js)/g)) {
    const path = new URL(match[1], new URL(script, site)).pathname;
    if (!assets.includes(path)) assets.push(path);
  }
}
const sw = await get(new URL('/sw.js', site));
if (sw.status === 200) {
  assets.push('/sw.js');
  if (sw.headers['cache-control'] !== 'no-cache') {
    problems.push(`/sw.js: cache-control ${sw.headers['cache-control']}`);
  }
}
for (const path of assets.slice(1)) {
  const response = await get(new URL(path, site));
  if (response.status !== 200) problems.push(`${path}: status ${response.status}`);
  checkHeaders(path, response);
}

for (const path of ['/', ...assets]) {
  const first = await get(new URL(path, site));
  const etag = first.headers.etag;
  if (!etag) {
    problems.push(`${path}: no ETag to revalidate with`);
    continue;
  }
  const revalidated = await get(new URL(path, site), { 'If-None-Match': etag });
  if (revalidated.status !== 304)
    problems.push(`${path}: revalidation status ${revalidated.status}`);
  else checkHeaders(`${path} (304)`, revalidated);
}

// CloudFront refuses methods other than GET and HEAD with 403, which the stack's error mapping
// serves as the app's 404 page; either way the refusal comes from the edge, not the origin.
const post = await new Promise((resolve, reject) => {
  const request = https.request(new URL('/', site), { method: 'POST' }, (response) => {
    response.resume();
    resolve({ status: response.statusCode, cache: response.headers['x-cache'] ?? '' });
  });
  request.on('error', reject);
  request.end('x');
});
if (![403, 404].includes(post.status) || !/Error from cloudfront/i.test(post.cache)) {
  problems.push(`POST /: status ${post.status}, x-cache ${post.cache}; expected an edge refusal`);
}

const plain = new URL('/', site);
plain.protocol = 'http:';
const redirect = await get(plain);
if (![301, 308].includes(redirect.status) || !redirect.headers.location?.startsWith('https://')) {
  problems.push(`http: status ${redirect.status}, location ${redirect.headers.location}`);
}

if (problems.length > 0) {
  console.error(`Live header check failed for ${site.origin}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `Live headers match headers.json on ${['/', ...assets].join(', ')}, including 304s; ` +
    'HTTP redirects to HTTPS; POST is refused.',
);
