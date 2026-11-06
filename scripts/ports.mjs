// SPDX-License-Identifier: GPL-3.0-or-later
// Ports per checkout (implementation plan §1.4). Concurrent sprints run `pnpm gate` in separate
// worktrees at the same time, so each checkout derives its own preview and E2E ports from its
// path. The main checkout keeps the conventional 4173/4174. BOGEY_PORT_BASE overrides.
import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** A stable small integer for a string (FNV-1a). */
function hash(text) {
  let h = 0x811c9dc5;
  for (const char of text) h = Math.imul(h ^ char.codePointAt(0), 0x01000193) >>> 0;
  return h;
}

export function portBase(path = root, override = process.env.BOGEY_PORT_BASE) {
  if (override) return Number(override);
  if (basename(path) === 'bogey') return 4173;
  return 4200 + (hash(path) % 400) * 10;
}

export const ports = (path) => {
  const base = portBase(path);
  return { dev: base + 2, preview: base, e2e: base + 1 };
};
