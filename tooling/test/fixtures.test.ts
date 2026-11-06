// The fixture manifest (requirements Appendix A, spec §14.2): every committed file is listed and
// matches its hash, fetched files match when present (and must be present in CI), and the A.5
// coverage matrix is satisfied by the manifest.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

interface Entry {
  path: string;
  source: string;
  license: string;
  sha256: string;
  formType: 'acroform' | 'xfa' | 'flat';
  xfa: 'none' | 'hybrid' | 'dynamic';
  encrypted: boolean;
  password: string | null;
  cipher?: string;
  rotation: number[];
  cropOrigin: boolean;
  pageCount: number;
  purpose: string;
  committed: boolean;
  fieldKinds?: string[];
  features?: string[];
  marks?: { page: number; x: number; y: number }[];
}

const manifest = JSON.parse(readFileSync(join(root, 'fixtures/manifest.json'), 'utf8')) as Entry[];
const sha256 = (path: string) =>
  createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');

function filesUnder(dir: string): string[] {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('fixtures/manifest.json', () => {
  it('lists each fixture once, with the documented keys', () => {
    const paths = manifest.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const entry of manifest) {
      expect(entry.path, entry.path).toMatch(/^fixtures\/(vendored|fetched)\/.+\.pdf$/);
      expect(entry.committed, entry.path).toBe(entry.path.startsWith('fixtures/vendored/'));
      expect(entry.sha256, entry.path).toMatch(/^[0-9a-f]{64}$/);
      expect(['acroform', 'xfa', 'flat'], entry.path).toContain(entry.formType);
      expect(['none', 'hybrid', 'dynamic'], entry.path).toContain(entry.xfa);
      expect(entry.formType === 'xfa', entry.path).toBe(entry.xfa !== 'none');
      expect(entry.encrypted, entry.path).toBe(entry.password !== null);
      expect(entry.pageCount, entry.path).toBeGreaterThan(0);
      expect(entry.purpose.length, entry.path).toBeGreaterThan(0);
    }
  });

  it('matches every committed file, and lists every PDF under fixtures/vendored', () => {
    const committed = manifest.filter((entry) => entry.committed);
    for (const entry of committed) {
      expect(existsSync(join(root, entry.path)), entry.path).toBe(true);
      expect(sha256(entry.path), entry.path).toBe(entry.sha256);
    }
    const listed = new Set(committed.map((entry) => entry.path));
    const unlisted = filesUnder('fixtures/vendored').filter(
      (path) => path.endsWith('.pdf') && !listed.has(path),
    );
    expect(unlisted).toEqual([]);
  });

  it('records the origin and license of every vendored third-party file', () => {
    const licenses = readFileSync(join(root, 'fixtures/LICENSES.md'), 'utf8');
    for (const entry of manifest.filter((e) => e.committed && e.source !== 'generated')) {
      expect(licenses, entry.path).toContain(entry.path.replace(/^fixtures\//, ''));
    }
  });

  it('matches fetched files that are present, and requires them in CI', () => {
    const fetched = manifest.filter((entry) => !entry.committed);
    const present = fetched.filter((entry) => existsSync(join(root, entry.path)));
    for (const entry of present) expect(sha256(entry.path), entry.path).toBe(entry.sha256);
    const missing = fetched.length - present.length;
    // In CI the fetch script runs first, so nothing may be missing; locally, absences are skipped.
    expect(process.env.CI ? missing : 0).toBe(0);
    if (missing > 0)
      console.info(`${missing} fetched fixtures are absent; run pnpm fixtures:fetch.`);
  });
});

/** Requirements A.5: each case must be covered by at least one manifest entry. */
const MATRIX: [string, (entries: Entry[]) => boolean][] = [
  ['Flat, single page', (e) => e.some((x) => x.formType === 'flat' && x.pageCount === 1)],
  [
    'Flat, multi-page, each rotation',
    (e) => {
      const rotations = new Set(
        e.filter((x) => x.formType === 'flat' && x.pageCount > 1).flatMap((x) => x.rotation),
      );
      return [0, 90, 180, 270].every((r) => rotations.has(r));
    },
  ],
  ['Non-zero crop box origin', (e) => e.some((x) => x.cropOrigin)],
  [
    'AcroForm, every field type',
    (e) =>
      e.some(
        (x) =>
          x.formType === 'acroform' &&
          ['text', 'checkbox', 'radio', 'dropdown', 'list'].every((k) => x.fieldKinds?.includes(k)),
      ),
  ],
  [
    'AcroForm with comb and max-length',
    (e) => e.some((x) => x.features?.includes('comb') && x.features.includes('max-length')),
  ],
  ['XFA, minimal', (e) => e.some((x) => x.source === 'pdfium' && x.formType === 'xfa')],
  ['XFA, production', (e) => e.some((x) => x.source === 'ircc' && x.formType === 'xfa')],
  [
    'Encrypted, user password, each cipher',
    (e) => {
      const ciphers = new Set(e.filter((x) => x.encrypted && x.password).map((x) => x.cipher));
      return ['RC4-40', 'RC4-128', 'AES-128', 'AES-256'].every((c) => ciphers.has(c));
    },
  ],
  ['Encrypted, owner password only', (e) => e.some((x) => x.encrypted && x.password === '')],
  ['Large document', (e) => e.some((x) => x.pageCount >= 20 && x.source === 'generated')],
];

describe('coverage matrix (requirements A.5)', () => {
  it.each(MATRIX)('%s', (_name, covered) => {
    expect(covered(manifest)).toBe(true);
  });

  it('has registration marks for every rotation and the crop box case (X5)', () => {
    const marked = manifest.filter((entry) => entry.marks?.length);
    const rotations = new Set(marked.flatMap((entry) => entry.rotation));
    expect([...rotations].sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    expect(marked.some((entry) => entry.cropOrigin)).toBe(true);
  });
});
