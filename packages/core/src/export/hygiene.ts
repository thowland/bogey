// Output hygiene (spec §9.1 steps 4 and 6, §11.4): no document JavaScript, no actions other than
// internal navigation and links, no additional actions, no active-media annotations, and no
// leftover encryption dictionaries.
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFHexString,
  PDFRawStream,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { get, getArray, getDict } from '../inspect/pdfObjects.ts';

const N = PDFName.of;

/**
 * The action policy (spec §9.1 step 4): an export keeps only `GoTo` (internal navigation) and
 * `URI` actions whose target is an absolute `http:`, `https:` or `mailto:` URL, which flattened
 * forms often carry and the recipient expects. Everything else (JavaScript, Launch, SubmitForm,
 * ImportData, ResetForm, Rendition, GoToR, GoToE, Hide, Named, other URI schemes, …) is removed,
 * and an `/OpenAction` keeps only `GoTo` (or a destination array).
 */
const SAFE_URI = /^(?:https?:\/\/|mailto:)[^\s\p{Cc}]+$/iu;

/** Annotation subtypes an export keeps; every other subtype (3D, RichMedia, Screen, Movie, Sound, unknown) is removed. */
export const PASSIVE_ANNOTATIONS: ReadonlySet<string> = new Set([
  'Text',
  'Link',
  'FreeText',
  'Line',
  'Square',
  'Circle',
  'Polygon',
  'PolyLine',
  'Highlight',
  'Underline',
  'Squiggly',
  'StrikeOut',
  'Stamp',
  'Caret',
  'Ink',
  'Popup',
  'Widget',
  // Kept like embedded files (spec §11.4); its actions are stripped like any other annotation's.
  'FileAttachment',
]);

const MAX_CHAIN = 256;
const MAX_OUTLINE_ITEMS = 100_000;
const MAX_OUTLINE_DEPTH = 64;

type ActionPolicy = (action: PDFDict) => boolean;

const actionType = (dict: PDFDict) => {
  const s = get(dict, 'S');
  return s instanceof PDFName ? s.decodeText() : '';
};

/** Whether an action may stay in a link, outline item or other annotation. */
export const isSafeAction: ActionPolicy = (action) => {
  const type = actionType(action);
  if (type === 'GoTo') return true;
  if (type !== 'URI') return false;
  const uri = get(action, 'URI');
  const text = uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : '';
  return SAFE_URI.test(text);
};

/** `/OpenAction` runs without a click, so only navigation survives there. */
const isSafeOpenAction: ActionPolicy = (action) => actionType(action) === 'GoTo';

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
 * order: the action itself when the policy allows it, otherwise its cleaned successors spliced
 * in. Cycles are cut at the first repeated action.
 */
function cleanChain(
  ctx: PDFContext,
  raw: PDFObject,
  safe: ActionPolicy,
  visited: Set<PDFDict>,
): PDFObject[] {
  const dict = ctx.lookup(raw);
  if (!(dict instanceof PDFDict) || visited.has(dict) || visited.size >= MAX_CHAIN) return [];
  visited.add(dict);
  const next = nextEntries(ctx, dict).flatMap((entry) => cleanChain(ctx, entry, safe, visited));
  if (!safe(dict)) return next;
  setNext(dict, next, ctx);
  return [raw];
}

/** Cleans the action stored under `key`; deletes the entry when nothing allowed remains. */
function cleanActionSlot(ctx: PDFContext, owner: PDFDict, key: string, safe = isSafeAction) {
  const raw = owner.get(N(key));
  if (raw === undefined) return;
  const kept = cleanChain(ctx, raw, safe, new Set());
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

/**
 * Cleans every outline item's action. Fails closed: an outline deeper or larger than the caps
 * (or with a cycle) is removed entirely, since bookmarks are a convenience in a flattened copy.
 */
function cleanOutlines(doc: PDFDocument) {
  const outlines = getDict(doc.catalog, 'Outlines');
  if (!outlines) return;
  const visited = new Set<PDFDict>();
  let exceeded = false;
  const walk = (first: PDFDict | undefined, depth: number) => {
    if (depth > MAX_OUTLINE_DEPTH) {
      if (first) exceeded = true;
      return;
    }
    for (let item = first; item && !exceeded; item = getDict(item, 'Next')) {
      if (visited.has(item) || visited.size >= MAX_OUTLINE_ITEMS) {
        exceeded = true;
        return;
      }
      visited.add(item);
      cleanActionSlot(doc.context, item, 'A');
      walk(getDict(item, 'First'), depth + 1);
    }
  };
  walk(getDict(outlines, 'First'), 0);
  if (exceeded) doc.catalog.delete(N('Outlines'));
}

/**
 * Removes active content (spec §9.1 step 4): the `/Names /JavaScript` tree; every `/AA`
 * (catalog, pages, annotations); annotations outside {@link PASSIVE_ANNOTATIONS}; and, wherever
 * an action lives (catalog `/OpenAction`, outline items, annotation `/A`), every action the
 * policy above does not allow, including those chained through `/Next`. An `/OpenAction` that
 * is a destination array is navigation and is kept. Embedded files are the sender's content and
 * stay (spec §11.4).
 */
export function stripActiveContent(doc: PDFDocument): void {
  const ctx = doc.context;
  const catalog = doc.catalog;
  getDict(catalog, 'Names')?.delete(N('JavaScript'));
  catalog.delete(N('AA'));
  if (get(catalog, 'OpenAction') instanceof PDFDict) {
    cleanActionSlot(ctx, catalog, 'OpenAction', isSafeOpenAction);
  }
  cleanOutlines(doc);
  for (const page of doc.getPages()) {
    page.node.delete(N('AA'));
    const annots = getArray(page.node, 'Annots');
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookup(i);
      const subtype = annot instanceof PDFDict ? get(annot, 'Subtype') : undefined;
      if (!(subtype instanceof PDFName) || !PASSIVE_ANNOTATIONS.has(subtype.decodeText())) {
        annots.remove(i);
        continue;
      }
      const dict = annot as PDFDict;
      dict.delete(N('AA'));
      cleanActionSlot(ctx, dict, 'A');
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
