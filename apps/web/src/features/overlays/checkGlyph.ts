// The check mark on screen (O4, spec §7.2). Export draws ZapfDingbats a20 at the box's size,
// centred by core's CHECK_GLYPH metrics; the screen draws the same glyph as an SVG path, so no
// Dingbats font has to be installed. The outline is a20 from FoxitDingbats, the ZapfDingbats
// substitute pdf.js ships (pdfjs-dist/standard_fonts, BSD licence), in 1000-unit glyph space with
// y up. The X is two stroked lines in both places.
import { CHECK_GLYPH, X_MARK } from '../../core-bridge/text.ts';

export const A20_PATH =
  'M55 104C51 70 81 47 104 28C117 18 158 -14 195 -14C221 -14 316 74 341 97L784 554' +
  'C806 576 811 576 811 605L811 670C811 699 811 705 779 705C761 705 753 701 740 691L519 488' +
  'C293 267 285 259 277 259C245 259 241 292 237 316L228 370C225 390 218 424 218 444' +
  'C218 495 156 489 122 477C101 470 82 445 69 429C36 390 36 397 36 345C36 301 36 268 41 225Z';

/** SVG viewBox: one box side is 1000 units, matching the glyph's 1000-unit em. */
export const BOX = 1000;

/**
 * The transform from glyph space to the box (y down): the glyph origin sits where export puts it,
 * `(1 − advance)/2` in from the left and `(1 − inkHeight)/2` up from the bottom.
 */
export function glyphTransform(): string {
  const u = ((1 - CHECK_GLYPH.advance) * BOX) / 2;
  const v = ((1 - CHECK_GLYPH.inkHeight) * BOX) / 2;
  return `translate(${u} ${BOX - v}) scale(1 -1)`;
}

/** The two strokes of the X, in box units with y down, and their width. */
export function xStrokes(): { lines: [number, number, number, number][]; width: number } {
  const a = X_MARK.inset * BOX;
  const b = BOX - a;
  return {
    lines: [
      [a, a, b, b],
      [a, b, b, a],
    ],
    width: X_MARK.strokePerPt * BOX,
  };
}
