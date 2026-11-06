import { describe, expect, it } from 'vitest';
import * as geometry from '../src/core-bridge/geometry.ts';
import * as text from '../src/core-bridge/text.ts';

describe('geometry and text bridges', () => {
  it('convert a point on a rotated page and back', () => {
    const page = geometry.pageGeometry({ mediaBox: [0, 0, 612, 792], rotate: 90 });
    const screen = geometry.pdfToScreen(page, { x: 100, y: 200 }, 1);
    const back = geometry.screenToPdf(page, screen, 1);
    expect(back.x).toBeCloseTo(100, 9);
    expect(back.y).toBeCloseTo(200, 9);
    expect(geometry.viewSize(page, 1).width).toBeCloseTo(792 * geometry.CSS_PX_PER_PT, 9);
  });

  it('lay out text and flag characters Helvetica cannot encode', () => {
    expect(text.layoutText('a\nbb', 10, false).lines).toEqual(['a', 'bb']);
    expect(text.nonWinAnsi('café 東')).toEqual(['東']);
    expect(text.formatDate({ y: 2026, m: 11, d: 6 }, 'YYYY-MM-DD')).toBe('2026-11-06');
  });
});
