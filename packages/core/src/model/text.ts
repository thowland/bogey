// Text and date constants shared by the screen and export (spec §7.2, O3, O5).

export const TEXT = Object.freeze({
  lineHeightFactor: 1.2,
  minSize: 6,
  maxSize: 36,
  defaultSize: 10,
});

export const CHECK = Object.freeze({ minSize: 8, maxSize: 24, defaultSize: 12 });

/** O6: default signature width in points. */
export const SIGNATURE_DEFAULT_WIDTH = 150;

export const DATE_FORMATS = ['MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY', 'Month D, YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DEFAULT_DATE_FORMAT: DateFormat = 'MM/DD/YYYY';
