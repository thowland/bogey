// Output hygiene (spec §9.1 steps 4 and 6, §11.4): no document JavaScript, no actions other than
// internal navigation and links, no additional actions, no active-media annotations, and no
// leftover encryption dictionaries.
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { get, getArray, getDict } from '../inspect/pdfObjects.ts';

const N = PDFName.of;

/**
 * Actions an export may keep: internal navigation and links, which flattened forms often carry
 * and the recipient expects. Everything else (JavaScript, Launch, SubmitForm, ImportData,
 * ResetForm, Rendition, GoToR, GoToE, Hide, Named, …) is removed.
 */
export const SAFE_ACTIONS: ReadonlySet<string> = new Set(['GoTo', 'URI']);

/** Annotation types that exist to run media or scripts; removed outright. */
export const ACTIVE_ANNOTATIONS: ReadonlySet<string> = new Set([
  'RichMedia',
  'Screen',
  'Movie',
  'Sound',
]);

const MAX_CHAIN = 256;
const MAX_OUTLINE_ITEMS = 100_000;
const MAX_OUTLINE_DEPTH = 64;

const actionType = (dict: PDFDict) => {
  const s = get(dict, 'S');
  return s instanceof PDFName ? s.decodeText() : '';
};

/** `/Next` as a list of raw entries (a single action or an array of them). */
function nextEntries(ctx: PDFContext, dict: PDFDict): PDFObject[] {
  const next = dict.get(N('Next'));
  if (next === undefined) return [];
  const resolved = ctx.lookup(next);
  return resolved instanceof PDFArray ? resolved.asArray() : [next];
}

function setNext(dict: PDFDict, entries: PDFObject[], ctx: PDFContext) {
  if (entries.length === 0) dict.delete(N('Next'));
  else if (entries.length === 1) dict.set(N('Next'), entries[0]!);
  else dict.set(N('Next'), ctx.obj(entries));
}

/**
 * Cleans one action and its `/Next` chain. Returns the actions that remain in its place, in
 * order: the action itself when it is safe, otherwise its cleaned successors spliced in. Cycles
 * are cut at the first repeated action.
 */
function cleanChain(ctx: PDFContext, raw: PDFObject, visited: Set<PDFDict>): PDFObject[] {
  const dict = ctx.lookup(raw);
  if (!(dict instanceof PDFDict) || visited.has(dict) || visited.size >= MAX_CHAIN) return [];
  visited.add(dict);
  const next = nextEntries(ctx, dict).flatMap((entry) => cleanChain(ctx, entry, visited));
  if (!SAFE_ACTIONS.has(actionType(dict))) return next;
  setNext(dict, next, ctx);
  return [raw];
}

/** Cleans the action stored under `key`; deletes the entry when nothing safe remains. */
function cleanActionSlot(ctx: PDFContext, owner: PDFDict, key: string) {
  const raw = owner.get(N(key));
  if (raw === undefined) return;
  const kept = cleanChain(ctx, raw, new Set());
  if (kept.length === 0) {
    owner.delete(N(key));
    return;
  }
  const [head, ...rest] = kept;
  owner.set(N(key), head!);
  if (rest.length > 0) {
    const headDict = ctx.lookup(head!) as PDFDict;
    setNext(headDict, [...nextEntries(ctx, headDict), ...rest], ctx);
  }
}

function cleanOutlines(doc: PDFDocument) {
  const outlines = getDict(doc.catalog, 'Outlines');
  if (!outlines) return;
  const visited = new Set<PDFDict>();
  const walk = (first: PDFDict | undefined, depth: number) => {
    let item = first;
    while (item && !visited.has(item) && visited.size < MAX_OUTLINE_ITEMS) {
      visited.add(item);
      cleanActionSlot(doc.context, item, 'A');
      if (depth < MAX_OUTLINE_DEPTH) walk(getDict(item, 'First'), depth + 1);
      item = getDict(item, 'Next');
    }
  };
  walk(getDict(outlines, 'First'), 0);
}

/**
 * Removes active content (spec §9.1 step 4): the `/Names /JavaScript` tree; every `/AA`
 * (catalog, pages, annotations); RichMedia, Screen, Movie and Sound annotations; and, wherever
 * an action lives (catalog `/OpenAction`, outline items, annotation `/A`), every action outside
 * {@link SAFE_ACTIONS}, including those chained through `/Next`. An `/OpenAction` that is a
 * destination array is navigation and is kept. Embedded files are the sender's content and stay.
 */
export function stripActiveContent(doc: PDFDocument): void {
  const ctx = doc.context;
  const catalog = doc.catalog;
  getDict(catalog, 'Names')?.delete(N('JavaScript'));
  catalog.delete(N('AA'));
  if (get(catalog, 'OpenAction') instanceof PDFDict) cleanActionSlot(ctx, catalog, 'OpenAction');
  cleanOutlines(doc);
  for (const page of doc.getPages()) {
    page.node.delete(N('AA'));
    const annots = getArray(page.node, 'Annots');
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = get(annot, 'Subtype');
      if (subtype instanceof PDFName && ACTIVE_ANNOTATIONS.has(subtype.decodeText())) {
        annots.remove(i);
        continue;
      }
      annot.delete(N('AA'));
      cleanActionSlot(ctx, annot, 'A');
    }
  }
}

/**
 * The fork decrypts objects but keeps the original's cross-reference streams and encryption
 * dictionary as ordinary objects, so the saved file still names `/Encrypt` (found in the Sprint 2
 * spike). Removes them so the output is unambiguously unencrypted (E9).
 */
export function removeEncryptionLeftovers(doc: PDFDocument): void {
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : undefined;
    if (!dict) continue;
    const isXref = object instanceof PDFRawStream && get(dict, 'Type') === N('XRef');
    const isEncrypt = get(dict, 'Filter') === N('Standard') && dict.has(N('O')) && dict.has(N('U'));
    if (isXref || isEncrypt) doc.context.delete(ref);
  }
}
