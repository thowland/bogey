// Snippet files and merging (spec §10.6, §14.3, M2).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SNIPPET_LIMITS,
  applySnippetMerge,
  parseSnippetFile,
  planSnippetMerge,
  serializeSnippets,
  snippetKey,
  type Snippet,
  type SnippetFileV1,
} from '../src/index.ts';

const snippet = (id: string, label: string, value: string, order: number): Snippet => ({
  id,
  label,
  value,
  order,
});

const file = (snippets: { label: string; value: string }[]): SnippetFileV1 => ({
  bogeySnippets: 1,
  exportedAt: '2026-11-06T14:30:00Z',
  snippets,
});

const text = (value: unknown) => JSON.stringify(value);

const problem = (result: ReturnType<typeof parseSnippetFile>) =>
  result.ok ? null : result.problems[0];

describe('parseSnippetFile', () => {
  it('reads the exported shape and trims labels', () => {
    const result = parseSnippetFile(
      text(
        file([
          { label: '  Full name ', value: 'Ada Lovelace' },
          { label: 'Phone', value: '' },
        ]),
      ),
    );
    expect(result).toEqual({
      ok: true,
      value: file([
        { label: 'Full name', value: 'Ada Lovelace' },
        { label: 'Phone', value: '' },
      ]),
    });
  });

  it('round-trips serializeSnippets, in display order', () => {
    const items = [snippet('b', 'Email', 'a@b.c', 1), snippet('a', 'Full name', 'Ada', 0)];
    const json = serializeSnippets(items, new Date('2026-11-06T14:30:00.123Z'));
    expect(JSON.parse(json)).toEqual(
      file([
        { label: 'Full name', value: 'Ada' },
        { label: 'Email', value: 'a@b.c' },
      ]),
    );
    expect(parseSnippetFile(json)).toMatchObject({ ok: true });
  });

  it.each([
    ['not JSON', '{'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a wrong version', text({ ...file([]), bogeySnippets: 2 })],
    ['a missing date', text({ bogeySnippets: 1, snippets: [] })],
    ['extra keys', text({ ...file([]), extra: true })],
    ['an own __proto__ key', '{"bogeySnippets":1,"exportedAt":"x","snippets":[],"__proto__":{}}'],
    ['a non-string value', text(file([{ label: 'A', value: 3 as unknown as string }]))],
    ['extra keys on an entry', text({ ...file([]), snippets: [{ label: 'A', value: '', id: 1 }] })],
    ['an empty label', text(file([{ label: '   ', value: 'x' }]))],
    ['snippets that are not a list', text({ ...file([]), snippets: {} })],
  ])('refuses %s as malformed', (_, input) => {
    expect(problem(parseSnippetFile(input))).toEqual({ code: 'snippets.malformed' });
  });

  it('refuses files over the limits as too large, saying which', () => {
    const big = 'x'.repeat(SNIPPET_LIMITS.maxFileBytes + 1);
    expect(problem(parseSnippetFile(big))).toEqual({
      code: 'snippets.too-large',
      data: { limit: 'file' },
    });
    const many = Array.from({ length: SNIPPET_LIMITS.maxSnippets + 1 }, (_, i) => ({
      label: `L${i}`,
      value: '',
    }));
    expect(problem(parseSnippetFile(text(file(many))))?.data).toEqual({ limit: 'count' });
    const longLabel = [{ label: 'é'.repeat(SNIPPET_LIMITS.maxLabel + 1), value: '' }];
    expect(problem(parseSnippetFile(text(file(longLabel))))?.data).toEqual({ limit: 'label' });
    const longValue = [{ label: 'A', value: 'v'.repeat(SNIPPET_LIMITS.maxValue + 1) }];
    expect(problem(parseSnippetFile(text(file(longValue))))?.data).toEqual({ limit: 'value' });
  });

  it('accepts entries exactly at the limits, counting characters rather than code units', () => {
    const entries = Array.from({ length: SNIPPET_LIMITS.maxSnippets }, (_, i) => ({
      label: i === 0 ? '😀'.repeat(SNIPPET_LIMITS.maxLabel) : `L${i}`,
      value: i === 0 ? 'v'.repeat(SNIPPET_LIMITS.maxValue) : '',
    }));
    expect(parseSnippetFile(text(file(entries))).ok).toBe(true);
  });

  it('counts the file size in UTF-8 bytes', () => {
    // Each 'é' is two bytes, so this is over the limit in bytes though not in characters.
    const value = 'é'.repeat(SNIPPET_LIMITS.maxFileBytes / 2);
    expect(problem(parseSnippetFile(text(file([{ label: 'A', value }]))))?.data).toEqual({
      limit: 'file',
    });
  });

  it('treats __proto__ and constructor as ordinary labels', () => {
    const result = parseSnippetFile(
      text(
        file([
          { label: '__proto__', value: 'p' },
          { label: 'constructor', value: 'c' },
        ]),
      ),
    );
    expect(result.ok && result.value.snippets.map((s) => s.label)).toEqual([
      '__proto__',
      'constructor',
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('planSnippetMerge', () => {
  const existing = [
    snippet('a', 'Full name', 'Ada', 0),
    snippet('b', 'Email', '', 1),
    snippet('c', 'Phone', '555', 2),
  ];

  it('matches labels case-insensitively after trimming, and appends new labels in file order', () => {
    const plan = planSnippetMerge(
      existing,
      file([
        { label: 'zip', value: '02139' },
        { label: '  EMAIL ', value: 'ada@example.com' },
        { label: 'full NAME', value: 'Ada' },
        { label: 'City', value: 'Cambridge' },
      ]),
      (() => {
        let n = 0;
        return () => `new-${++n}`;
      })(),
    );
    expect(plan.overwritten).toEqual([snippet('b', 'Email', 'ada@example.com', 1)]);
    expect(plan.unchanged).toBe(1);
    expect(plan.added).toEqual([
      snippet('new-1', 'zip', '02139', 3),
      snippet('new-2', 'City', 'Cambridge', 4),
    ]);
    expect(applySnippetMerge(existing, plan).map((s) => [s.label, s.value, s.order])).toEqual([
      ['Full name', 'Ada', 0],
      ['Email', 'ada@example.com', 1],
      ['Phone', '555', 2],
      ['zip', '02139', 3],
      ['City', 'Cambridge', 4],
    ]);
  });

  it('lets the last entry for a label in one file win', () => {
    const plan = planSnippetMerge(
      [],
      file([
        { label: 'A', value: '1' },
        { label: 'B', value: '2' },
        { label: 'a', value: '3' },
      ]),
    );
    expect(plan.added.map((s) => [s.label, s.value])).toEqual([
      ['A', '3'],
      ['B', '2'],
    ]);
  });

  it('keys __proto__ labels through a Map', () => {
    const plan = planSnippetMerge(
      [snippet('p', '__proto__', 'old', 0)],
      file([
        { label: '__PROTO__', value: 'new' },
        { label: 'hasOwnProperty', value: 'h' },
      ]),
    );
    expect(plan.overwritten).toEqual([snippet('p', '__proto__', 'new', 0)]);
    expect(plan.added.map((s) => s.label)).toEqual(['hasOwnProperty']);
  });

  it('gives added snippets ids that are not already taken', () => {
    const plan = planSnippetMerge(
      [snippet('snippet-1', 'X', '', 0)],
      file([
        { label: 'Y', value: '' },
        { label: 'Z', value: '' },
      ]),
    );
    expect(plan.added.map((s) => s.id)).toEqual(['snippet-2', 'snippet-3']);
  });

  it('matches only the first of existing duplicate labels', () => {
    const dupes = [snippet('x', 'Name', '1', 0), snippet('y', 'name', '2', 1)];
    const plan = planSnippetMerge(dupes, file([{ label: 'NAME', value: '3' }]));
    expect(plan.overwritten.map((s) => s.id)).toEqual(['x']);
  });

  it('renumbers orders that have gaps', () => {
    const gappy = [snippet('a', 'A', '', 4), snippet('b', 'B', '', 9)];
    const merged = applySnippetMerge(gappy, planSnippetMerge(gappy, file([])));
    expect(merged.map((s) => s.order)).toEqual([0, 1]);
  });

  it('snippetKey trims and lower-cases', () => {
    expect(snippetKey('  Full NAME ')).toBe('full name');
  });
});

// spec §14.3: importing a file twice produces the same result as importing it once.
describe('merge idempotence (property)', () => {
  const label = fc.oneof(
    fc.constantFrom('Full name', 'full name ', 'EMAIL', 'Email', '__proto__', 'constructor', 'Zip'),
    fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim() !== ''),
  );
  const entry = fc.record({ label, value: fc.string({ maxLength: 6 }) });
  const existingArb = fc
    .array(entry, { maxLength: 8 })
    .map((entries) => entries.map((e, i) => snippet(`e${i}`, e.label.trim(), e.value, i * 2)));
  const fileArb = fc.array(entry, { maxLength: 10 }).map((entries) => file(entries));

  it('import(import(s, f), f) equals import(s, f)', () => {
    fc.assert(
      fc.property(existingArb, fileArb, (existing, incoming) => {
        const once = applySnippetMerge(existing, planSnippetMerge(existing, incoming));
        const second = planSnippetMerge(once, incoming);
        expect(second.added).toEqual([]);
        expect(second.overwritten).toEqual([]);
        expect(applySnippetMerge(once, second)).toEqual(once);
      }),
    );
  });

  it('never loses or duplicates an existing snippet', () => {
    fc.assert(
      fc.property(existingArb, fileArb, (existing, incoming) => {
        const merged = applySnippetMerge(existing, planSnippetMerge(existing, incoming));
        expect(new Set(merged.map((s) => s.id)).size).toBe(merged.length);
        for (const s of existing) expect(merged.some((m) => m.id === s.id)).toBe(true);
        expect(merged.map((s) => s.order)).toEqual(merged.map((_, i) => i));
      }),
    );
  });
});
