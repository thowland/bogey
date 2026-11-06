// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Tim Howland

// The service worker kill switch (spec §11.5, T5). Writes a /sw.js that, once a visitor's browser
// fetches it, deletes every Bogey cache and unregisters itself, so a bad or compromised build can
// be purged from visitors' browsers. The procedure is in CLAUDE.md under Security constraints.
//
//   node scripts/sw-kill.ts [output]       # default apps/web/dist/sw.js
//
// The browser checks /sw.js against the network on every navigation (`updateViaCache: 'none'`),
// so the next visit installs this worker. It activates at once, and pages the old worker
// controlled switch to it and reload (src/sw/register.ts) onto whatever the server now has. It
// has no fetch handler, so nothing is served from a cache. While this file is deployed, the app
// registers /sw.js again on each load, which brings back this same worker: still no caches and
// no fetch handling. Deploying a normal build replaces it.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KILL_SWITCH_SOURCE = `// Bogey service worker kill switch (scripts/sw-kill.ts).
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.registration.unregister()),
  );
});
`;

export function writeKillSwitch(output: string): void {
  writeFileSync(output, KILL_SWITCH_SOURCE);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output =
    process.argv[2] ?? fileURLToPath(new URL('../apps/web/dist/sw.js', import.meta.url));
  writeKillSwitch(output);
  console.log(`Wrote the service worker kill switch to ${output}`);
}
