import { describe, expect, it } from 'vitest';
import {
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_SNIPPET_LABELS,
  EMPTY_EDIT_STATE,
  OVERLAY_TYPES,
  PROBLEM_CODES,
  TEXT,
  fail,
  ok,
} from '../src/index.ts';

describe('result helpers', () => {
  it('wraps values and problems', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
    expect(fail({ code: 'file.not-pdf' })).toEqual({
      ok: false,
      problems: [{ code: 'file.not-pdf' }],
    });
  });

  it('keeps problem codes unique', () => {
    expect(new Set(PROBLEM_CODES).size).toBe(PROBLEM_CODES.length);
  });
});

describe('constants from the requirements', () => {
  it('match O3, O5, N1', () => {
    expect(TEXT).toMatchObject({ minSize: 6, maxSize: 36, defaultSize: 10 });
    expect(DATE_FORMATS).toContain(DEFAULT_DATE_FORMAT);
    expect(DEFAULT_DATE_FORMAT).toBe('MM/DD/YYYY');
    expect(DEFAULT_SNIPPET_LABELS).toHaveLength(6);
    expect(OVERLAY_TYPES).toEqual(['text', 'date', 'check', 'signature']);
  });

  it('freezes the empty edit state', () => {
    expect(Object.isFrozen(EMPTY_EDIT_STATE)).toBe(true);
    expect(Object.isFrozen(EMPTY_EDIT_STATE.overlays)).toBe(true);
  });
});
