// Snippet files and merging (spec §10.6, M2). The file is validated with zod, run jitless because
// the CSP forbids `new Function` (spec §10.1). Labels are matched through a Map keyed by the
// trimmed, lower-cased label, so a label such as `__proto__` is an ordinary string.
import { z } from 'zod';
import type { Snippet, SnippetFileV1 } from '../model/library.ts';
import { fail, ok, type Problem, type Result } from '../result.ts';

z.config({ jitless: true });

export const SNIPPET_LIMITS = Object.freeze({
  /** File size in bytes (UTF-8). */
  maxFileBytes: 256 * 1024,
  maxSnippets: 200,
  /** Characters (code points), after trimming for labels. */
  maxLabel: 60,
  maxValue: 2_000,
});

/** What a too-large problem is about; the message table words each one. */
export type SnippetLimit = 'file' | 'count' | 'label' | 'value';

const length = (text: string) => [...text].length;

const entrySchema = z.strictObject({
  label: z.string(),
  value: z.string(),
});

const fileSchema = z.strictObject({
  bogeySnippets: z.literal(1),
  exportedAt: z.string().max(64),
  snippets: z.array(entrySchema),
});

const tooLarge = (limit: SnippetLimit): Result<never> =>
  fail<Problem>({ code: 'snippets.too-large', data: { limit } });

const malformed = (): Result<never> => fail<Problem>({ code: 'snippets.malformed' });

/** The key labels are matched by (spec §10.6): trimmed, case-insensitive. */
export const snippetKey = (label: string): string => label.trim().toLowerCase();

/**
 * Reads a `bogey-snippets.json` file (M2). Anything but that exact shape is malformed; a file over
 * the limits (spec §10.6) is refused whole. Labels come back trimmed and never empty.
 */
export function parseSnippetFile(text: string): Result<SnippetFileV1> {
  if (new TextEncoder().encode(text).length > SNIPPET_LIMITS.maxFileBytes) return tooLarge('file');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return malformed();
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) return malformed();
  const { snippets, exportedAt } = parsed.data;
  if (snippets.length > SNIPPET_LIMITS.maxSnippets) return tooLarge('count');
  const cleaned: { label: string; value: string }[] = [];
  for (const entry of snippets) {
    const label = entry.label.trim();
    if (label === '') return malformed();
    if (length(label) > SNIPPET_LIMITS.maxLabel) return tooLarge('label');
    if (length(entry.value) > SNIPPET_LIMITS.maxValue) return tooLarge('value');
    cleaned.push({ label, value: entry.value });
  }
  return ok({ bogeySnippets: 1, exportedAt, snippets: cleaned });
}

/** The file M2 exports, in the snippets' order. `now` is for tests. */
export function serializeSnippets(snippets: readonly Snippet[], now: Date = new Date()): string {
  const file: SnippetFileV1 = {
    bogeySnippets: 1,
    exportedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    snippets: [...snippets]
      .sort((a, b) => a.order - b.order)
      .map(({ label, value }) => ({ label, value })),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export interface SnippetMergePlan {
  /** New labels, in file order, with orders after the existing snippets. */
  added: Snippet[];
  /** Existing snippets whose value the file replaces, with the new value. */
  overwritten: Snippet[];
  /** File entries that match an existing snippet with the same value. */
  unchanged: number;
}

/**
 * Plans an import (M2, spec §10.6). Labels match case-insensitively after trimming; a matched
 * snippet keeps its id, label and place and takes the file's value. Within one file the last entry
 * for a label wins. `newId` names added snippets; the default never repeats an existing id.
 */
export function planSnippetMerge(
  existing: readonly Snippet[],
  incoming: SnippetFileV1,
  newId: () => string = sequentialIds(existing),
): SnippetMergePlan {
  const byKey = new Map<string, Snippet>();
  for (const snippet of [...existing].sort((a, b) => a.order - b.order)) {
    const key = snippetKey(snippet.label);
    if (!byKey.has(key)) byKey.set(key, snippet);
  }
  // Last value per label, at the position of its first appearance.
  const wanted = new Map<string, { label: string; value: string }>();
  for (const entry of incoming.snippets) {
    const key = snippetKey(entry.label);
    const first = wanted.get(key);
    wanted.set(key, { label: first?.label ?? entry.label.trim(), value: entry.value });
  }

  const nextOrder = existing.reduce((max, s) => Math.max(max, s.order + 1), 0);
  const added: Snippet[] = [];
  const overwritten: Snippet[] = [];
  let unchanged = 0;
  for (const [key, entry] of wanted) {
    const match = byKey.get(key);
    if (!match) {
      added.push({
        id: newId(),
        label: entry.label,
        value: entry.value,
        order: nextOrder + added.length,
      });
    } else if (match.value === entry.value) {
      unchanged++;
    } else {
      overwritten.push({ ...match, value: entry.value });
    }
  }
  return { added, overwritten, unchanged };
}

/** The snippets after a planned import, renumbered 0…n−1 in display order. */
export function applySnippetMerge(existing: readonly Snippet[], plan: SnippetMergePlan): Snippet[] {
  const replaced = new Map(plan.overwritten.map((snippet) => [snippet.id, snippet]));
  return [...existing.map((snippet) => replaced.get(snippet.id) ?? snippet), ...plan.added]
    .sort((a, b) => a.order - b.order)
    .map((snippet, order) => (snippet.order === order ? snippet : { ...snippet, order }));
}

function sequentialIds(existing: readonly Snippet[]): () => string {
  const taken = new Set(existing.map((snippet) => snippet.id));
  let n = 0;
  return () => {
    let id: string;
    do id = `snippet-${++n}`;
    while (taken.has(id));
    taken.add(id);
    return id;
  };
}
