// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Tim Howland

// Checks a deployed Bogey against apps/web/security/headers.json:
//   node scripts/check-live-headers.mjs https://bogey.beta-site.us
// Every header must match exactly on the page, the main script, both workers (the pdf worker and
// the pdf.js worker, found in the main script and the chunks it loads), and /sw.js, and on a 304
// revalidation too, since WebKit checks COEP against the 304 when it loads a worker and the
// service worker caches what it is served (spec §11.5, §11.7). /sw.js must be no-cache and must
// precache both workers. Plain HTTP must redirect to HTTPS, and a
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
const workers = [];
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
  // The pdf.js worker is referenced from a lazily loaded chunk, so look one level down too.
  const bodies = [{ base: script, body: main.body }];
  for (const match of main.body.matchAll(/["'`(](\.{1,2}\/[\w.-]+-[\w-]+\.js)["'`)]/g)) {
    const path = new URL(match[1], new URL(script, site)).pathname;
    if (/worker/.test(path)) continue;
    const chunk = await get(new URL(path, site));
    if (chunk.status === 200) bodies.push({ base: path, body: chunk.body });
  }
  for (const { base, body } of bodies) {
    for (const match of body.matchAll(/["'`(]([^"'`()]*worker[\w.]*-[\w-]+\.m?js)/g)) {
      const path = new URL(match[1], new URL(base, site)).pathname;
      if (!workers.includes(path)) workers.push(path);
    }
  }
  if (workers.length < 2) {
    problems.push(`expected the pdf worker and the pdf.js worker, found: ${workers.join(', ')}`);
  }
  assets.push(...workers);
}
const sw = await get(new URL('/sw.js', site));
if (sw.status !== 200) problems.push(`/sw.js: status ${sw.status}`);
else {
  assets.push('/sw.js');
  if (sw.headers['cache-control'] !== 'no-cache') {
    problems.push(`/sw.js: cache-control ${sw.headers['cache-control']}`);
  }
  if (!/javascript/.test(sw.headers['content-type'] ?? '')) {
    problems.push(`/sw.js: content-type ${sw.headers['content-type']}`);
  }
  // A kill switch (scripts/sw-kill.ts) precaches nothing; a normal build precaches both workers.
  if (!sw.body.includes('kill switch')) {
    for (const worker of workers) {
      if (!sw.body.includes(worker)) problems.push(`/sw.js: does not precache ${worker}`);
    }
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
