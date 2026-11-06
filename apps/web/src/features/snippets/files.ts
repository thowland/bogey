// Snippet export and import (M2, spec §10.6). Export downloads `bogey-snippets.json`; import reads
// a file the user chose, refuses it whole if it is too large or not a snippets file, and plans the
// merge so the panel can confirm any overwrites before anything changes.
import type { Problem, Snippet } from '@bogey/core';
import { TIMING } from '../../config.ts';
import {
  SNIPPET_LIMITS,
  applySnippetMerge,
  parseSnippetFile,
  planSnippetMerge,
  serializeSnippets,
} from '../../core-bridge/snippets.ts';
import { useSnippetsStore } from '../../state/snippets.ts';

export const SNIPPET_FILE_NAME = 'bogey-snippets.json';

export interface SaveDeps {
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  click(anchor: HTMLAnchorElement): void;
  later(run: () => void, ms: number): void;
}

const browserDeps = (): SaveDeps => ({
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  click: (anchor) => {
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  },
  later: (run, ms) => {
    setTimeout(run, ms);
  },
});

/** Downloads the snippets as `bogey-snippets.json`. Safari reads the URL after the click. */
export function exportSnippets(
  items: readonly Snippet[],
  deps: SaveDeps = browserDeps(),
  now: Date = new Date(),
): void {
  const blob = new Blob([serializeSnippets([...items], now)], { type: 'application/json' });
  const url = deps.createUrl(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = SNIPPET_FILE_NAME;
  anchor.rel = 'noopener';
  deps.click(anchor);
  deps.later(() => deps.revokeUrl(url), TIMING.revokeDownloadUrlAfterMs);
}

export interface ImportPlan {
  /** The list after the import. */
  next: Snippet[];
  added: number;
  /** Labels whose values the import replaces, in list order. */
  overwritten: string[];
  unchanged: number;
}

export type ReadResult = { ok: true; plan: ImportPlan } | { ok: false; problem: Problem };

/** Reads a chosen file and plans the import against the current snippets (M2). */
export async function readSnippetFile(
  file: Pick<File, 'size' | 'text'>,
  existing: readonly Snippet[] = useSnippetsStore.getState().items,
): Promise<ReadResult> {
  // Refused before reading, so a large file is never held in memory.
  if (file.size > SNIPPET_LIMITS.maxFileBytes) {
    return { ok: false, problem: { code: 'snippets.too-large', data: { limit: 'file' } } };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, problem: { code: 'snippets.malformed' } };
  }
  const parsed = parseSnippetFile(text);
  if (!parsed.ok) return { ok: false, problem: parsed.problems[0]! };
  const plan = planSnippetMerge([...existing], parsed.value, () => crypto.randomUUID());
  return {
    ok: true,
    plan: {
      next: applySnippetMerge([...existing], plan),
      added: plan.added.length,
      overwritten: plan.overwritten.map((item) => item.label),
      unchanged: plan.unchanged,
    },
  };
}

/** One sentence saying what an import did. */
export function importSummary(plan: Pick<ImportPlan, 'added' | 'overwritten'>): string {
  const added = plan.added;
  const updated = plan.overwritten.length;
  const count = (n: number) => `${n} ${n === 1 ? 'snippet' : 'snippets'}`;
  if (added === 0 && updated === 0) return 'Your snippets already match that file.';
  if (updated === 0) return `Added ${count(added)}.`;
  if (added === 0) return `Updated ${count(updated)}.`;
  return `Added ${count(added)} and updated ${updated}.`;
}
