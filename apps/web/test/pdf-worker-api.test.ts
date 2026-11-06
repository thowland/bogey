// The pdf worker's API, run in-process on a committed fixture (spec §6, §9).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pdfWorkerApi } from '../src/workers/pdfWorkerApi.ts';

// Vitest serves test modules from /@fs URLs here, so locate the repository from the working directory.
const repoRoot = existsSync(resolve(process.cwd(), 'fixtures'))
  ? process.cwd()
  : resolve(process.cwd(), '../..');
const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(repoRoot, 'fixtures/vendored/generated', name)));

describe('pdf worker API', () => {
  it('inspects and exports', async () => {
    const bytes = fixture('acroform-all.pdf');
    const info = await pdfWorkerApi.inspect(bytes);
    if (!info.ok) throw new Error('inspect');
    expect(info.value.formType).toBe('acroform');
    const stages: string[] = [];
    const out = await pdfWorkerApi.exportPdf(
      {
        bytes,
        info: info.value,
        state: { fieldValues: { text1: 'Hello' }, overlays: [] },
        signatures: new Map(),
        options: { replaceNonWinAnsi: false, now: 0 },
      },
      (s) => stages.push(s),
    );
    expect(out.ok).toBe(true);
    expect(stages.at(-1)).toBe('checking');
    const encrypted = await pdfWorkerApi.inspect(fixture('acroform-all-aes256.pdf'), 'bogey');
    expect(encrypted).toMatchObject({ ok: true, value: { encrypted: true } });
  });

  it('passes failures through', async () => {
    const info = await pdfWorkerApi.inspect(fixture('flat-single.pdf'));
    if (!info.ok) throw new Error('inspect');
    const out = await pdfWorkerApi.exportPageImages({
      pages: [],
      info: info.value,
      state: { fieldValues: {}, overlays: [] },
      signatures: new Map(),
      options: { replaceNonWinAnsi: false, now: 0 },
    });
    expect(out.ok).toBe(false);
  });
});
