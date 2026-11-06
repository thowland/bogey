// Active-content stripping (spec §9.1 step 4, §11.4): an allow-list of actions, applied wherever
// actions live, with /Next chains spliced and cycles cut.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFObject,
  type PDFRef,
} from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  chainSatisfies,
  isSafeAction,
  isSafeOpenAction,
  removeEncryptionLeftovers,
  stripActiveContent,
} from '../src/export/hygiene.ts';
import { exportPdf, inspectPdf } from '../src/index.ts';
import { makeForm } from './helpers.ts';

const N = PDFName.of;

async function hostile() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const action = (s: string, extra: Record<string, unknown> = {}) =>
    ctx.register(ctx.obj({ S: s, ...extra }));
  const js = () => action('JavaScript', { JS: PDFString.of('app.alert(1)') });
  const uri = (u: string) => action('URI', { URI: PDFString.of(u) });

  // OpenAction: GoTo → JavaScript → GoTo → URI. The JavaScript in the middle is spliced out, and
  // the URI goes because an OpenAction keeps navigation only.
  const tail = action('GoTo', {
    D: ctx.obj([page.ref, N('Fit')]),
    Next: uri('https://example.com/open'),
  });
  const middle = action('JavaScript', { JS: PDFString.of('x'), Next: tail });
  const goTo = action('GoTo', { D: ctx.obj([page.ref, N('Fit')]), Next: middle });
  doc.catalog.set(N('OpenAction'), goTo);

  // A cyclic chain on a link: URI → JavaScript → back to the URI.
  const loopUri = ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com/loop') });
  const loopUriRef = ctx.register(loopUri);
  const loopJs = action('JavaScript', { JS: PDFString.of('y'), Next: loopUriRef });
  loopUri.set(N('Next'), loopJs);
  const link = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: loopUriRef }),
  );
  // A link whose JavaScript action has an array of successors: only the safe ones survive.
  const branching = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [20, 0, 30, 10],
      A: action('JavaScript', {
        JS: PDFString.of('z'),
        Next: ctx.obj([
          uri('https://example.com/a'),
          js(),
          uri('javascript:alert(1)'),
          uri('file:///etc/passwd'),
          uri('mailto:someone@example.com'),
        ]),
      }),
    }),
  );
  // A widget-style annotation with SubmitForm in /AA and ImportData in /A.
  const widget = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      Rect: [40, 0, 50, 10],
      A: action('ImportData', { F: PDFString.of('data.fdf') }),
      AA: ctx.obj({ U: action('SubmitForm', { F: PDFString.of('https://evil.example') }) }),
    }),
  );
  const media = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'RichMedia', Rect: [0, 0, 1, 1] }));
  const screen = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Screen', Rect: [0, 0, 1, 1] }));
  const threeD = ctx.register(ctx.obj({ Type: 'Annot', Subtype: '3D', Rect: [0, 0, 1, 1] }));
  const unknown = ctx.register(ctx.obj({ Type: 'Annot', Rect: [0, 0, 1, 1] }));
  const attachment = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [0, 0, 1, 1], A: js() }),
  );
  const badLink = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1], A: uri(' javascript:alert(2)') }),
  );
  for (const a of [link, branching, widget, media, screen, threeD, unknown, attachment, badLink]) {
    page.node.addAnnot(a);
  }

  // Outlines: an item with a JavaScript /A and a child with a GoTo; siblings form a cycle.
  const outlines = ctx.obj({ Type: 'Outlines' });
  const outlinesRef = ctx.register(outlines);
  const child = ctx.obj({
    Title: PDFString.of('child'),
    A: action('GoTo', { D: ctx.obj([page.ref, N('Fit')]) }),
  });
  const childRef = ctx.register(child);
  const first = ctx.obj({
    Title: PDFString.of('first'),
    A: js(),
    First: childRef,
    Parent: outlinesRef,
  });
  const firstRef = ctx.register(first);
  const second = ctx.obj({ Title: PDFString.of('second'), A: action('Launch') });
  const secondRef = ctx.register(second);
  first.set(N('Next'), secondRef);
  outlines.set(N('First'), firstRef);
  doc.catalog.set(N('Outlines'), outlinesRef);
  doc.catalog.set(N('AA'), ctx.obj({ WC: js() }));
  page.node.set(N('AA'), ctx.obj({ O: js() }));
  doc.catalog.set(
    N('Names'),
    ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('a'), js()] }) }),
  );
  return {
    doc,
    page,
    link,
    branching,
    widget,
    goTo,
    tail,
    first,
    second,
    child,
    loopUri,
    attachment,
    badLink,
  };
}

const lookup = (doc: PDFDocument, ref: PDFRef) => doc.context.lookup(ref, PDFDict);
const sOf = (doc: PDFDocument, value: unknown) =>
  (doc.context.lookup(value as PDFRef) as PDFDict).get(N('S'))?.toString();

describe('stripActiveContent', () => {
  it('keeps only GoTo and URI actions, splicing /Next chains and cutting cycles', async () => {
    const h = await hostile();
    stripActiveContent(h.doc);
    const { doc } = h;

    // OpenAction: GoTo, then the GoTo that followed the removed JavaScript, and no URI.
    const open = doc.catalog.lookup(N('OpenAction'), PDFDict);
    expect(sOf(doc, doc.catalog.get(N('OpenAction')))).toBe('/GoTo');
    const second = doc.context.lookup(open.get(N('Next')), PDFDict);
    expect(second.get(N('S'))?.toString()).toBe('/GoTo');
    expect(second.get(N('Next'))).toBeUndefined();

    // The cyclic link keeps its URI and loses the JavaScript and the loop.
    const link = lookup(doc, h.link);
    expect(sOf(doc, link.get(N('A')))).toBe('/URI');
    expect(doc.context.lookup(link.get(N('A')), PDFDict).get(N('Next'))).toBeUndefined();

    // The branching link: the JavaScript head is replaced by the https URI, the mailto URI
    // follows; the javascript: and file: URIs are dropped.
    const branching = lookup(doc, h.branching);
    const head = doc.context.lookup(branching.get(N('A')), PDFDict);
    expect(head.get(N('URI'))?.toString()).toContain('example.com/a');
    const after = doc.context.lookup(head.get(N('Next')), PDFDict);
    expect(after.get(N('URI'))?.toString()).toContain('mailto:');
    expect(after.get(N('Next'))).toBeUndefined();
    expect(lookup(doc, h.badLink).get(N('A'))).toBeUndefined();

    // The widget loses both its ImportData action and its SubmitForm additional action.
    const widget = lookup(doc, h.widget);
    expect(widget.get(N('A'))).toBeUndefined();
    expect(widget.get(N('AA'))).toBeUndefined();

    // Outline items: JavaScript and Launch removed, the child's GoTo kept.
    expect(h.first.get(N('A'))).toBeUndefined();
    expect(h.second.get(N('A'))).toBeUndefined();
    expect(sOf(doc, h.child.get(N('A')))).toBe('/GoTo');

    // Only passive annotations remain: two links, the widget, the attachment (without its
    // action) and the bad link; RichMedia, Screen, 3D and the untyped one are gone.
    const annots = h.page.node.lookup(N('Annots'), PDFArray);
    expect(annots.size()).toBe(5);
    expect(lookup(doc, h.attachment).get(N('A'))).toBeUndefined();
    expect(doc.catalog.get(N('AA'))).toBeUndefined();
    expect(h.page.node.get(N('AA'))).toBeUndefined();
    expect(doc.catalog.lookup(N('Names'), PDFDict).get(N('JavaScript'))).toBeUndefined();
  });

  it('keeps slots independent when they share an action (copy on write)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const ctx = doc.context;
    const uri = ctx.register(ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com') }));
    const shared = ctx.register(
      ctx.obj({ S: 'GoTo', D: ctx.obj([page.ref, N('Fit')]), Next: uri }),
    );
    // The link is cleaned after the OpenAction and would splice the URI back into the shared GoTo.
    const js = ctx.register(
      ctx.obj({ S: 'JavaScript', JS: PDFString.of('x'), Next: ctx.obj([shared, uri]) }),
    );
    doc.catalog.set(N('OpenAction'), shared);
    const link = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1], A: js }),
    );
    page.node.addAnnot(link);
    stripActiveContent(doc);
    const chain = (start: unknown) => {
      const types: string[] = [];
      let d: PDFDict | undefined = doc.context.lookup(start as PDFRef) as PDFDict;
      while (d && types.length < 10) {
        types.push(String(d.get(N('S'))));
        const next: PDFObject | undefined = d.get(N('Next'));
        const resolved: PDFObject | undefined =
          next === undefined ? undefined : doc.context.lookup(next);
        d =
          resolved instanceof PDFArray
            ? (doc.context.lookup(resolved.get(0)) as PDFDict)
            : (resolved as PDFDict | undefined);
      }
      return types;
    };
    expect(chain(doc.catalog.get(N('OpenAction')))).toEqual(['/GoTo']);
    expect(chain(lookup(doc, link).get(N('A')))).toContain('/URI');
  });

  it('removes an /OpenAction that a final check finds unsafe', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    // A destination array is not an action dictionary and stays; an unsafe dict chain goes.
    const bad = doc.context.obj({
      S: 'GoTo',
      Next: doc.context.obj([doc.context.obj({ S: 'URI' })]),
    });
    doc.catalog.set(N('OpenAction'), doc.context.register(bad));
    stripActiveContent(doc);
    expect(sOf(doc, doc.catalog.get(N('OpenAction')))).toBe('/GoTo');
    expect(doc.catalog.lookup(N('OpenAction'), PDFDict).get(N('Next'))).toBeUndefined();
  });

  it('removes an outline tree that is cyclic, too deep or too large (fail closed)', async () => {
    const outline = async (build: (doc: PDFDocument) => PDFDict) => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const root = doc.context.obj({ Type: 'Outlines' });
      root.set(N('First'), doc.context.register(build(doc)));
      doc.catalog.set(N('Outlines'), doc.context.register(root));
      stripActiveContent(doc);
      return doc.catalog.get(N('Outlines'));
    };
    // A cycle among siblings.
    expect(
      await outline((doc) => {
        const a = doc.context.obj({ Title: PDFString.of('a') });
        a.set(N('Next'), doc.context.register(a));
        return a;
      }),
    ).toBeUndefined();
    // Nesting deeper than the cap.
    expect(
      await outline((doc) => {
        let item = doc.context.obj({ Title: PDFString.of('leaf') });
        for (let i = 0; i < 70; i++) {
          item = doc.context.obj({
            Title: PDFString.of(`l${i}`),
            First: doc.context.register(item),
          });
        }
        return item;
      }),
    ).toBeUndefined();
    // A shallow, well-formed outline survives.
    expect(await outline((doc) => doc.context.obj({ Title: PDFString.of('ok') }))).toBeDefined();
  });

  it('keeps a destination-array OpenAction and removes an unsafe one entirely', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const dest = doc.context.obj([page.ref, N('Fit')]);
    doc.catalog.set(N('OpenAction'), dest);
    stripActiveContent(doc);
    expect(doc.catalog.get(N('OpenAction'))).toBe(dest);
    doc.catalog.set(N('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: PDFString.of('1') }));
    stripActiveContent(doc);
    expect(doc.catalog.get(N('OpenAction'))).toBeUndefined();
    // A URI is never kept as an OpenAction, even with a safe scheme.
    doc.catalog.set(
      N('OpenAction'),
      doc.context.obj({ S: 'URI', URI: PDFString.of('https://example.com') }),
    );
    stripActiveContent(doc);
    expect(doc.catalog.get(N('OpenAction'))).toBeUndefined();
  });

  it('runs as part of export, which leaves no JavaScript in the output', async () => {
    const bytes = await makeForm({ javascript: true });
    const info = await inspectPdf(bytes);
    if (!info.ok) throw new Error('inspect failed');
    const out = await exportPdf({
      bytes,
      info: info.value,
      state: { fieldValues: {}, overlays: [] },
      signatures: new Map(),
      options: { replaceNonWinAnsi: false, now: 0 },
    });
    if (!out.ok) throw new Error(JSON.stringify(out.problems));
    const text = new TextDecoder('latin1').decode(out.value.bytes);
    expect(text).not.toMatch(/JavaScript|Launch|\/AA/);
  });
});

describe('removeEncryptionLeftovers', () => {
  it('deletes encryption dictionaries kept as ordinary objects', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const ref = doc.context.register(
      doc.context.obj({ Filter: 'Standard', O: PDFString.of('o'), U: PDFString.of('u') }),
    );
    removeEncryptionLeftovers(doc);
    expect(doc.context.lookup(ref)).toBeUndefined();
  });
});

describe('isSafeAction', () => {
  it('decodes UTF-16 URIs and allows only http, https and mailto', async () => {
    const doc = await PDFDocument.create();
    const uri = (value: PDFString | PDFHexString) => doc.context.obj({ S: 'URI', URI: value });
    expect(isSafeAction(uri(PDFHexString.fromText('https://example.com/ü')))).toBe(true);
    expect(isSafeAction(uri(PDFString.of('MAILTO:a@b.c')))).toBe(true);
    expect(isSafeAction(uri(PDFHexString.fromText('JavaScript:alert(1)')))).toBe(false);
    expect(isSafeAction(uri(PDFString.of('https://exa mple.com')))).toBe(false);
    expect(isSafeAction(uri(PDFString.of('ftp://example.com')))).toBe(false);
    expect(isSafeAction(doc.context.obj({ S: 'URI' }))).toBe(false);
    expect(isSafeAction(doc.context.obj({ S: 'GoTo' }))).toBe(true);
    expect(isSafeAction(doc.context.obj({}))).toBe(false);
  });
});

describe('chainSatisfies', () => {
  it('re-checks a whole chain, cycles included', async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const a = ctx.obj({ S: 'GoTo' });
    const aRef = ctx.register(a);
    a.set(N('Next'), ctx.obj([aRef]));
    expect(chainSatisfies(ctx, aRef, isSafeOpenAction)).toBe(true);
    a.set(N('Next'), ctx.obj({ S: 'URI', URI: PDFString.of('https://x.y') }));
    expect(chainSatisfies(ctx, aRef, isSafeOpenAction)).toBe(false);
    expect(chainSatisfies(ctx, aRef, isSafeAction)).toBe(true);
    expect(chainSatisfies(ctx, ctx.obj([]), isSafeAction)).toBe(false);
  });
});

describe('stripActiveContent at scale', () => {
  /** One page with `links` Link annotations sharing one chain of `length` alternating actions. */
  async function sharedChain(links: number, length: number) {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const ctx = doc.context;
    let next: PDFRef | undefined;
    for (let i = length - 1; i >= 0; i--) {
      const action =
        i % 2 === 0
          ? ctx.obj({ S: 'URI', URI: PDFString.of(`https://example.com/${i}`) })
          : ctx.obj({ S: 'JavaScript', JS: PDFString.of(`step(${i})`) });
      if (next) action.set(N('Next'), next);
      next = ctx.register(action);
    }
    const head = ctx.register(
      ctx.obj({ S: 'GoTo', D: ctx.obj([page.ref, N('Fit')]), Next: next! }),
    );
    doc.catalog.set(N('OpenAction'), head);
    const annots = ctx.obj([]);
    for (let i = 0; i < links; i++) {
      annots.push(
        ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1], A: head })),
      );
    }
    page.node.set(N('Annots'), annots);
    return { doc, page };
  }

  it('cleans 5,000 links sharing one 200-action chain in linear work', async () => {
    const { doc, page } = await sharedChain(5_000, 200);
    const start = performance.now();
    const { cloned } = stripActiveContent(doc);
    expect(performance.now() - start).toBeLessThan(10_000);
    // One copy per distinct kept action per policy, not per slot.
    expect(cloned).toBeLessThanOrEqual(2 * 200);
    const open = doc.catalog.lookup(N('OpenAction'), PDFDict);
    expect(chainSatisfies(doc.context, doc.catalog.get(N('OpenAction'))!, isSafeOpenAction)).toBe(
      true,
    );
    expect(open.get(N('Next'))).toBeUndefined();
    const annots = page.node.lookup(N('Annots'), PDFArray);
    const first = annots.lookup(0, PDFDict).get(N('A'));
    expect(annots.lookup(4_999, PDFDict).get(N('A'))).toBe(first);
    expect(chainSatisfies(doc.context, first!, isSafeAction)).toBe(true);
  });

  it('drops actions once the clone budget is spent (fail closed)', async () => {
    const { doc, page } = await sharedChain(3, 20);
    const { cloned } = stripActiveContent(doc, { cloneBudget: 2 });
    expect(cloned).toBe(2);
    const annots = page.node.lookup(N('Annots'), PDFArray);
    const a = annots.lookup(0, PDFDict).get(N('A'));
    // Whatever survived is still within policy.
    expect(a === undefined || chainSatisfies(doc.context, a, isSafeAction)).toBe(true);
  });
});

describe('stripActiveContent bounds', () => {
  it('collapses a diamond DAG of unsafe actions instead of growing exponentially', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const ctx = doc.context;
    let level: PDFRef[] = [
      ctx.register(ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com/end') })),
    ];
    for (let i = 0; i < 30; i++) {
      const next = ctx.obj(level.length === 1 ? [level[0]!, level[0]!] : level);
      level = [0, 1].map(() =>
        ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('x'), Next: next })),
      );
    }
    const top = ctx.register(
      ctx.obj({ S: 'JavaScript', JS: PDFString.of('top'), Next: ctx.obj(level) }),
    );
    const link = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1], A: top }),
    );
    page.node.addAnnot(link);
    const start = performance.now();
    stripActiveContent(doc);
    expect(performance.now() - start).toBeLessThan(1_000);
    const a = doc.context.lookup(link, PDFDict).get(N('A'));
    expect(sOf(doc, a)).toBe('/URI');
    expect(doc.context.lookup(a!, PDFDict).get(N('Next'))).toBeUndefined();
  });

  it('leaves nothing for a /Next wider or a chain deeper than the cap', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const ctx = doc.context;
    const uri = () => ctx.register(ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com') }));
    const wide = ctx.obj({ S: 'JavaScript', Next: ctx.obj(Array.from({ length: 300 }, uri)) });
    let deep: PDFRef = uri();
    for (let i = 0; i < 300; i++) deep = ctx.register(ctx.obj({ S: 'GoTo', Next: deep }));
    const links = [wide, deep].map((A) =>
      ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1], A })),
    );
    for (const l of links) page.node.addAnnot(l);
    stripActiveContent(doc);
    expect(doc.context.lookup(links[0]!, PDFDict).get(N('A'))).toBeUndefined();
    const deepKept = doc.context.lookup(links[1]!, PDFDict).get(N('A'));
    // The over-deep tail is cut, so whatever remains is within the cap.
    expect(deepKept === undefined || chainSatisfies(doc.context, deepKept, isSafeAction)).toBe(
      true,
    );
  });
});

describe('pruneUnreachable', () => {
  it('drops objects nothing references and keeps the page tree', async () => {
    const { PDFDocument, PDFName } = await import('@cantoo/pdf-lib');
    const { pruneUnreachable } = await import('../src/export/hygiene.ts');
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const orphan = doc.context.register(
      doc.context.obj({ S: PDFName.of('JavaScript'), JS: 'app.alert(1)' }),
    );
    const linked = doc.context.register(doc.context.obj({ Kept: true }));
    doc.catalog.set(PDFName.of('Kept'), linked);
    await doc.flush();
    expect(pruneUnreachable(doc)).toBeGreaterThanOrEqual(1);
    expect(doc.context.lookup(orphan)).toBeUndefined();
    expect(doc.context.lookup(linked)).toBeDefined();
    const reloaded = await PDFDocument.load(await doc.save());
    expect(reloaded.getPageCount()).toBe(1);
  });
});
