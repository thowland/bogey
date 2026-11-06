// Output hygiene (spec §9.1 steps 4 and 6, §11.4): no document JavaScript, no actions other than
// internal navigation and links, no additional actions, no active-media annotations, and no
// leftover encryption dictionaries.
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFHexString,
  PDFInvalidObject,
  PDFRawStream,
  PDFRef,
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
export const isSafeOpenAction: ActionPolicy = (action) => actionType(action) === 'GoTo';

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

/** Clones of action dictionaries one export may make before it drops actions instead. */
export const CLONE_BUDGET = 10_000;

const sameEntries = (a: readonly PDFObject[], b: readonly PDFObject[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** A cleaned chain: the actions left in place, and the longest chain among them. */
interface Cleaned {
  readonly list: readonly PDFObject[];
  readonly height: number;
}

const NOTHING: Cleaned = Object.freeze({ list: Object.freeze([]), height: 0 });

/** Deduplicated (first occurrence wins), or null when longer than MAX_CHAIN (fail closed). */
function bounded(list: readonly PDFObject[]): PDFObject[] | null {
  const out = [...new Set(list)];
  return out.length > MAX_CHAIN ? null : out;
}

/**
 * Cleans action chains for one export. Results are memoized per (policy, action dictionary), so a
 * shared action or chain suffix is cleaned once per policy and every slot reuses the result:
 * the work is linear in distinct objects. A kept action is copied only when its `/Next` changes
 * (copy on write, so cleaning one slot never rewires a dictionary another slot shares), and
 * copies are capped by a global budget; past it, actions are dropped (fail closed).
 */
class ActionCleaner {
  cloned = 0;
  private readonly chains = new Map<ActionPolicy, Map<PDFDict, Cleaned>>();
  private readonly slots = new Map<ActionPolicy, Map<PDFDict, PDFObject | null>>();
  private readonly inProgress = new Set<PDFDict>();
  private readonly ctx: PDFContext;
  private readonly budget: number;

  constructor(ctx: PDFContext, budget: number) {
    this.ctx = ctx;
    this.budget = budget;
  }

  private memo<V>(maps: Map<ActionPolicy, Map<PDFDict, V>>, policy: ActionPolicy) {
    let map = maps.get(policy);
    if (!map) {
      map = new Map();
      maps.set(policy, map);
    }
    return map;
  }

  private copyWithNext(dict: PDFDict, next: PDFObject[]): PDFObject | null {
    if (this.cloned >= this.budget) return null;
    this.cloned++;
    const copy = dict.clone(this.ctx);
    setNext(copy, next, this.ctx);
    return this.ctx.register(copy);
  }

  /**
   * The actions that remain in place of `raw`, in order: the action itself (or a copy with a
   * cleaned `/Next`) when the policy allows it, otherwise its cleaned successors spliced in.
   * Bounded and fail closed: a cycle is cut where it closes; lists are deduplicated; a list longer
   * than MAX_CHAIN, a `/Next` wider than that, or a chain that would run deeper than MAX_CHAIN
   * from here leaves nothing.
   */
  chain(raw: PDFObject, policy: ActionPolicy, depth = 0): Cleaned {
    const dict = this.ctx.lookup(raw);
    if (!(dict instanceof PDFDict)) return NOTHING;
    const memo = this.memo(this.chains, policy);
    const hit = memo.get(dict);
    if (hit) return depth + hit.height > MAX_CHAIN ? NOTHING : hit;
    if (this.inProgress.has(dict) || depth >= MAX_CHAIN) return NOTHING;
    const original = nextEntries(this.ctx, dict);
    let result: Cleaned;
    if (original.length > MAX_CHAIN) {
      result = NOTHING;
    } else {
      this.inProgress.add(dict);
      const children = original.map((entry) => this.chain(entry, policy, depth + 1));
      this.inProgress.delete(dict);
      const next = bounded(children.flatMap((c) => c.list));
      const below = Math.max(0, ...children.map((c) => c.height));
      if (next === null) result = NOTHING;
      else if (!policy(dict)) result = { list: next, height: below };
      else if (sameEntries(original, next)) result = { list: [raw], height: below + 1 };
      else {
        const copy = this.copyWithNext(dict, next);
        result = copy ? { list: [copy], height: below + 1 } : NOTHING;
      }
    }
    memo.set(dict, result);
    return result;
  }

  /** The single action to store in a slot, or null when nothing allowed remains. */
  slot(raw: PDFObject, policy: ActionPolicy): PDFObject | null {
    const dict = this.ctx.lookup(raw);
    if (!(dict instanceof PDFDict)) return null;
    const memo = this.memo(this.slots, policy);
    if (memo.has(dict)) return memo.get(dict)!;
    const [head, ...rest] = this.chain(raw, policy).list;
    let result: PDFObject | null = head ?? null;
    if (head !== undefined && rest.length > 0) {
      // Several survivors: the first runs, then its own successors, then the others.
      const headDict = this.ctx.lookup(head) as PDFDict;
      const combined = bounded([...nextEntries(this.ctx, headDict), ...rest]);
      result = combined === null ? null : this.copyWithNext(headDict, combined);
    }
    memo.set(dict, result);
    return result;
  }
}

/** Cleans the action stored under `key`; deletes the entry when nothing allowed remains. */
function cleanActionSlot(
  cleaner: ActionCleaner,
  owner: PDFDict,
  key: string,
  policy: ActionPolicy = isSafeAction,
) {
  const raw = owner.get(N(key));
  if (raw === undefined) return;
  const kept = cleaner.slot(raw, policy);
  if (kept === null) owner.delete(N(key));
  else owner.set(N(key), kept);
}

/** Whether every action reachable from `raw` satisfies `safe` (a fail-closed re-check). */
export function chainSatisfies(ctx: PDFContext, raw: PDFObject, safe: ActionPolicy): boolean {
  const seen = new Set<PDFDict>();
  const pending = [raw];
  while (pending.length > 0) {
    const dict = ctx.lookup(pending.pop()!);
    if (!(dict instanceof PDFDict)) return false;
    if (seen.has(dict)) continue;
    if (seen.size >= MAX_CHAIN || !safe(dict)) return false;
    seen.add(dict);
    const next = nextEntries(ctx, dict);
    if (pending.length + next.length > MAX_CHAIN) return false;
    pending.push(...next);
  }
  return true;
}

/**
 * Cleans every outline item's action. Fails closed: an outline deeper or larger than the caps
 * (or with a cycle) is removed entirely, since bookmarks are a convenience in a flattened copy.
 */
function cleanOutlines(doc: PDFDocument, cleaner: ActionCleaner) {
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
      cleanActionSlot(cleaner, item, 'A');
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
export function stripActiveContent(
  doc: PDFDocument,
  opts: { cloneBudget?: number } = {},
): { cloned: number } {
  const ctx = doc.context;
  const cleaner = new ActionCleaner(ctx, opts.cloneBudget ?? CLONE_BUDGET);
  const catalog = doc.catalog;
  getDict(catalog, 'Names')?.delete(N('JavaScript'));
  catalog.delete(N('AA'));
  if (get(catalog, 'OpenAction') instanceof PDFDict) {
    cleanActionSlot(cleaner, catalog, 'OpenAction', isSafeOpenAction);
  }
  cleanOutlines(doc, cleaner);
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
      cleanActionSlot(cleaner, dict, 'A');
    }
  }
  // Fail closed: whatever happened above, an /OpenAction dictionary must be navigation only.
  const open = catalog.get(N('OpenAction'));
  if (
    open !== undefined &&
    ctx.lookup(open) instanceof PDFDict &&
    !chainSatisfies(ctx, open, isSafeOpenAction)
  ) {
    catalog.delete(N('OpenAction'));
  }
  return { cloned: cleaner.cloned };
}

const latin1 = (bytes: Uint8Array) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return out;
};

/**
 * The fork decrypts objects but keeps the original's cross-reference streams and encryption
 * dictionary as ordinary objects, so the saved file still names `/Encrypt` (found in the Sprint 2
 * spike). Removes them so the output is unambiguously unencrypted (E9).
 */
export function removeEncryptionLeftovers(doc: PDFDocument): void {
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    // A cross-reference stream the fork tried to decrypt does not parse and is kept verbatim.
    if (object instanceof PDFInvalidObject) {
      const bytes = new Uint8Array(object.sizeInBytes());
      object.copyBytesInto(bytes, 0);
      if (/\/(XRef|Encrypt)\b/.test(latin1(bytes))) doc.context.delete(ref);
      continue;
    }
    const dict =
      object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : undefined;
    if (!dict) continue;
    const isXref = object instanceof PDFRawStream && get(dict, 'Type') === N('XRef');
    const isEncrypt = get(dict, 'Filter') === N('Standard') && dict.has(N('O')) && dict.has(N('U'));
    if (isXref || isEncrypt) doc.context.delete(ref);
  }
}

/**
 * pdf-lib writes every object in its context, referenced or not, so actions and annotations that
 * stripActiveContent unlinked would still be in the saved file (found in Sprint 9: the hostile
 * fixture's export still contained JavaScript and Launch objects that no reader could reach).
 * Keeps only what is reachable from the trailer's /Root and /Info and drops the rest, which
 * also drops replaced appearance streams and parsed object streams. Call after doc.flush(), so
 * fonts and images embedded during export already exist. Returns the number of objects dropped.
 */
export function pruneUnreachable(doc: PDFDocument): number {
  const ctx = doc.context;
  const reachable = new Set<string>();
  const pending: PDFObject[] = [];
  const { Root, Info } = ctx.trailerInfo;
  if (Root) pending.push(Root);
  if (Info) pending.push(Info);
  while (pending.length > 0) {
    const object = pending.pop()!;
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = ctx.lookup(object);
      if (target) pending.push(target);
    } else if (object instanceof PDFDict) {
      for (const value of object.values()) pending.push(value);
    } else if (object instanceof PDFArray) {
      for (let i = 0; i < object.size(); i++) pending.push(object.get(i));
    } else if (object instanceof PDFStream) {
      pending.push(object.dict);
    }
  }
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      ctx.delete(ref);
      dropped++;
    }
  }
  return dropped;
}
