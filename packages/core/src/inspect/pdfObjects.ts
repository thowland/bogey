// Small helpers for reading pdf-lib's object model defensively: hostile files put the wrong type
// anywhere, so every read checks the type and falls back rather than throwing.
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFObject,
} from '@cantoo/pdf-lib';

export const name = (key: string): PDFName => PDFName.of(key);

/** A direct or indirect entry of `dict`, resolved. */
export function get(dict: PDFDict, key: string): PDFObject | undefined {
  const value = dict.get(PDFName.of(key));
  return value === undefined ? undefined : dict.context.lookup(value);
}

export function getDict(dict: PDFDict, key: string): PDFDict | undefined {
  const value = get(dict, key);
  return value instanceof PDFDict ? value : undefined;
}

export function getArray(dict: PDFDict, key: string): PDFArray | undefined {
  const value = get(dict, key);
  return value instanceof PDFArray ? value : undefined;
}

export function getNumber(dict: PDFDict, key: string): number | undefined {
  const value = get(dict, key);
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

export function getText(dict: PDFDict, key: string): string | undefined {
  const value = get(dict, key);
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFName) return value.decodeText();
  return undefined;
}

export function getBool(dict: PDFDict, key: string): boolean | undefined {
  const value = get(dict, key);
  return value instanceof PDFBool ? value.asBoolean() : undefined;
}

/** Walks `/Parent` links (page tree or field tree) for an inheritable attribute. */
export function inherited(dict: PDFDict, key: string): PDFObject | undefined {
  let node: PDFDict | undefined = dict;
  for (let depth = 0; node && depth < 64; depth++) {
    const value = get(node, key);
    if (value !== undefined) return value;
    node = getDict(node, 'Parent');
  }
  return undefined;
}

/** An array of four numbers, or undefined. */
export function numbersOf(value: PDFObject | undefined): number[] | undefined {
  if (!(value instanceof PDFArray)) return undefined;
  const out: number[] = [];
  for (let i = 0; i < value.size(); i++) {
    const item = value.lookup(i);
    if (!(item instanceof PDFNumber)) return undefined;
    out.push(item.asNumber());
  }
  return out.length >= 4 && out.every(Number.isFinite) ? out.slice(0, 4) : undefined;
}
