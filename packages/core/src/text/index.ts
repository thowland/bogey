// Text (spec §7.2, §9.2): Helvetica metrics from pdf-lib's AFM data, overlay line layout, the
// field auto-size pdf-lib's appearance generator would choose, WinAnsi validation and dates.
import {
  StandardFontEmbedder,
  TextAlignment,
  layoutCombedText,
  layoutMultilineText,
  layoutSinglelineText,
  type PDFFont,
} from '@cantoo/pdf-lib';
import { Encodings, FontNames } from '@cantoo/pdf-lib/standard-fonts';
import type { DateFormat } from '../model/text.ts';
import { TEXT } from '../model/text.ts';

const regular = StandardFontEmbedder.for(FontNames.Helvetica);
const bold = StandardFontEmbedder.for(FontNames.HelveticaBold);

/** Helvetica's ascender and descender as fractions of the font size (AFM: 718, −207). */
export const HELVETICA = Object.freeze({ ascender: 0.718, descender: 0.207 });

/** Width in points of one line of text in Helvetica (or Helvetica-Bold). */
export function textWidth(text: string, size: number, isBold = false): number {
  return (isBold ? bold : regular).widthOfTextAtSize(sanitize(text), size);
}

/**
 * Lines and extent of a text or date overlay in the upright frame (spec §7.2): lines break only
 * where the user typed a line break, and each line is `lineHeightFactor × size` below the last.
 */
export function layoutText(
  text: string,
  size: number,
  isBold: boolean,
): { lines: string[]; width: number; height: number } {
  const lines = text.split(/\r\n|\r|\n/);
  const width = Math.max(0, ...lines.map((line) => textWidth(line, size, isBold)));
  return { lines, width, height: lines.length * TEXT.lineHeightFactor * size };
}

/** Distinct characters that Helvetica's WinAnsi encoding cannot represent, in order of appearance (E4). */
export function nonWinAnsi(text: string): string[] {
  const found = new Set<string>();
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') continue;
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0)!)) found.add(ch);
  }
  return [...found];
}

/** E4: every character outside WinAnsi becomes '?'. Line breaks are kept. */
export function replaceNonWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    out +=
      ch === '\n' || ch === '\r' || Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0)!)
        ? ch
        : '?';
  }
  return out;
}

/** Measuring never throws: characters Helvetica cannot encode are measured as '?'. */
const sanitize = (text: string) => replaceNonWinAnsi(text).replace(/[\r\n]/g, ' ');

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** O5 date formats. `m` is 1-based. */
export function formatDate(d: { y: number; m: number; d: number }, fmt: DateFormat): string {
  const month = MONTHS[(((d.m - 1) % 12) + 12) % 12]!;
  switch (fmt) {
    case 'MM/DD/YYYY':
      return `${pad(d.m, 2)}/${pad(d.d, 2)}/${pad(d.y, 4)}`;
    case 'YYYY-MM-DD':
      return `${pad(d.y, 4)}-${pad(d.m, 2)}-${pad(d.d, 2)}`;
    case 'DD MMM YYYY':
      return `${pad(d.d, 2)} ${month.slice(0, 3)} ${pad(d.y, 4)}`;
    case 'Month D, YYYY':
      return `${month} ${d.d}, ${pad(d.y, 4)}`;
  }
}

/** The subset of PDFFont that pdf-lib's layout functions use. */
const helveticaForLayout = {
  widthOfTextAtSize: (text: string, size: number) => regular.widthOfTextAtSize(text, size),
  heightAtSize: (size: number, options?: { descender?: boolean }) =>
    regular.heightOfFontAtSize(size, options),
  encodeText: (text: string) => regular.encodeText(text),
} as unknown as PDFFont;

const ALIGNMENT = {
  left: TextAlignment.Left,
  center: TextAlignment.Center,
  right: TextAlignment.Right,
} as const;

export interface FieldTextBox {
  /** Widget size in points, in the widget's own (`/MK /R`-rotated) frame. */
  width: number;
  height: number;
  /** `/BS /W`; pdf-lib uses 0 when the widget has no border style. */
  borderWidth?: number;
}

/**
 * The font size pdf-lib's appearance generator chooses for a text field whose `/DA` size is 0
 * (auto), so the on-screen control can match the export (spec §7.1).
 */
export function autoFieldFontSize(
  text: string,
  box: FieldTextBox,
  field: {
    multiline?: boolean;
    comb?: boolean;
    maxLength?: number;
    textAlign?: keyof typeof ALIGNMENT;
  },
): number {
  const value = field.multiline ? replaceNonWinAnsi(text) : sanitize(text);
  const comb = field.comb === true && field.maxLength !== undefined && field.maxLength > 0;
  const border = box.borderWidth ?? 0;
  const padding = comb ? 0 : 1;
  const bounds = {
    x: border + padding,
    y: border + padding,
    width: Math.max(0, box.width - (border + padding) * 2),
    height: Math.max(0, box.height - (border + padding) * 2),
  };
  const options = { font: helveticaForLayout, bounds, fontSize: 0 };
  if (field.multiline) {
    return layoutMultilineText(value, {
      ...options,
      alignment: ALIGNMENT[field.textAlign ?? 'left'],
    }).fontSize;
  }
  if (comb) {
    const cellCount = field.maxLength!;
    return layoutCombedText([...value].slice(0, cellCount).join(''), { ...options, cellCount })
      .fontSize;
  }
  return layoutSinglelineText(value, {
    ...options,
    alignment: ALIGNMENT[field.textAlign ?? 'left'],
  }).fontSize;
}
