// On-screen text metrics (spec §7.2, O3). Overlay text is shown in Liberation Sans ('Bogey
// Overlay'), which has Helvetica's advance widths, so widths come from core's Helvetica metrics.
// The baseline is placed from Liberation Sans's own `hhea` metrics: with line height L and size s,
// CSS puts the first baseline (L − (ascender + descender)·s)/2 + ascender·s below the top of the
// line box, which is where these functions put it too.
import { TEXT } from '../../core-bridge/model.ts';

export const LIBERATION_SANS = Object.freeze({ ascender: 0.905, descender: 0.212 });

/** Line height in points for text of this size, on screen and in export. */
export const lineHeight = (size: number): number => TEXT.lineHeightFactor * size;

/** Distance in points from the top of a text box to its first baseline. */
export function firstBaseline(size: number): number {
  const { ascender, descender } = LIBERATION_SANS;
  return (lineHeight(size) - (ascender + descender) * size) / 2 + ascender * size;
}
