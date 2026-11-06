// Text (spec §7.2, §9.2, §9.4, §14.3).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DATE_FORMATS,
  TEXT,
  autoFieldFontSize,
  formatDate,
  layoutText,
  nonWinAnsi,
  outputFileName,
  replaceNonWinAnsi,
  textWidth,
} from '../src/index.ts';

describe('layoutText', () => {
  it('splits on line breaks and measures Helvetica', () => {
    const l = layoutText('Hello\nWorld!', 10, false);
    expect(l.lines).toEqual(['Hello', 'World!']);
    expect(l.height).toBeCloseTo(2 * TEXT.lineHeightFactor * 10, 9);
    // Helvetica AFM widths: H 722, e 556, l 222, o 556.
    expect(textWidth('Hello', 10)).toBeCloseTo((722 + 556 + 222 + 222 + 556) / 100, 6);
    expect(textWidth('Hello', 10, true)).toBeGreaterThan(textWidth('Hello', 10));
    expect(l.width).toBe(Math.max(textWidth('Hello', 10), textWidth('World!', 10)));
    expect(layoutText('', 10, false)).toEqual({ lines: [''], width: 0, height: 12 });
    expect(textWidth('Ωx', 10)).toBe(textWidth('?x', 10));
  });
});

describe('nonWinAnsi', () => {
  it('lists distinct offending characters in order', () => {
    expect(nonWinAnsi('café € ok')).toEqual([]);
    expect(nonWinAnsi('Ωmega ✓ Ω\n')).toEqual(['Ω', '✓']);
    expect(nonWinAnsi('😀')).toEqual(['😀']);
    expect(replaceNonWinAnsi('aΩ\nb😀')).toBe('a?\nb?');
  });

  it('agrees with replaceNonWinAnsi', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        const replaced = replaceNonWinAnsi(s);
        expect(nonWinAnsi(replaced)).toEqual([]);
        expect(replaced === s).toBe(nonWinAnsi(s).length === 0);
      }),
    );
  });
});

describe('formatDate', () => {
  it('formats each O5 format', () => {
    const d = { y: 2026, m: 3, d: 7 };
    expect(DATE_FORMATS.map((f) => formatDate(d, f))).toEqual([
      '03/07/2026',
      '2026-03-07',
      '07 Mar 2026',
      'March 7, 2026',
    ]);
  });
});

describe('autoFieldFontSize', () => {
  it('shrinks to fit and matches pdf-lib bounds', () => {
    const big = autoFieldFontSize('Hi', { width: 200, height: 20 }, {});
    const long = autoFieldFontSize(
      'A much longer value that must shrink',
      { width: 100, height: 20 },
      {},
    );
    expect(big).toBeGreaterThan(long);
    expect(big).toBeLessThanOrEqual(20);
    expect(
      autoFieldFontSize('12345', { width: 100, height: 20 }, { comb: true, maxLength: 5 }),
    ).toBeGreaterThan(4);
    expect(
      autoFieldFontSize(
        'line one\nline two',
        { width: 100, height: 60, borderWidth: 1 },
        { multiline: true, textAlign: 'center' },
      ),
    ).toBeGreaterThan(4);
  });
});

describe('outputFileName', () => {
  it('handles the documented cases (spec §9.4)', () => {
    expect(outputFileName('Lease.PDF')).toBe('Lease-signed.pdf');
    expect(outputFileName('a/b\\c:d*.pdf')).toBe('abcd-signed.pdf');
    expect(outputFileName('...pdf')).toBe('document-signed.pdf');
    expect(outputFileName('name. .pdf')).toBe('name-signed.pdf');
    expect(outputFileName('x'.repeat(200))).toBe(`${'x'.repeat(120)}-signed.pdf`);
    expect(outputFileName('\u0001')).toBe('document-signed.pdf');
  });

  it('always ends in -signed.pdf with no separator or forbidden character', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (name) => {
        const out = outputFileName(name);
        expect(out.endsWith('-signed.pdf')).toBe(true);
        const stem = out.slice(0, -'-signed.pdf'.length);
        expect(stem).not.toMatch(/[<>:"/\\|?*\p{Cc}]/u);
        expect(stem).not.toMatch(/[. ]$/);
        expect([...stem].length).toBeLessThanOrEqual(120);
      }),
    );
  });
});
