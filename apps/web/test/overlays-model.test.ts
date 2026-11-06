// Overlay geometry, placement, manipulation and keys (spec §5.3, §7.2, O2–O9, U2).
import type { Overlay, PageGeometry, Rotation } from '@bogey/core';
import { describe, expect, it } from 'vitest';
import { pdfToScreen } from '../src/core-bridge/geometry.ts';
import { CHECK_GLYPH } from '../src/core-bridge/text.ts';
import { A20_PATH, BOX, glyphTransform, xStrokes } from '../src/features/overlays/checkGlyph.ts';
import {
  historyKey,
  inDialog,
  isDeleteKey,
  nudgeForKey,
  toolForKey,
} from '../src/features/overlays/keys.ts';
import {
  MIN_SIGNATURE_WIDTH,
  isTap,
  movedAnchor,
  nudgedAnchor,
  overlayLabel,
  overlayRect,
  pagePoint,
  placeOverlay,
  resizePatch,
  sizePatch,
  type PlacementDefaults,
} from '../src/features/overlays/model.ts';
import {
  LIBERATION_SANS,
  firstBaseline,
  lineHeight,
} from '../src/features/overlays/textMetrics.ts';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const page = (
  rotate: Rotation = 0,
  view: PageGeometry['view'] = [0, 0, 612, 792],
): PageGeometry => ({
  index: 0,
  view,
  rotate,
  userUnit: 1,
});
const K = 96 / 72;

const text = (over: Partial<Overlay> = {}): Overlay =>
  ({
    id: 't',
    type: 'text',
    page: 0,
    x: 100,
    y: 700,
    text: 'Hello',
    size: 10,
    bold: false,
    ...over,
  }) as Overlay;
const check: Overlay = { id: 'c', type: 'check', page: 0, x: 50, y: 50, glyph: 'check', size: 12 };
const sig: Overlay = {
  id: 's',
  type: 'signature',
  page: 0,
  x: 200,
  y: 300,
  width: 150,
  height: 50,
  signatureId: 'lib',
};

const defaults: PlacementDefaults = {
  id: 'new',
  page: 0,
  textSize: 10,
  dateText: '11/06/2026',
  glyph: 'x',
  signature: { id: 'lib', width: 300, height: 100 },
};

describe('text metrics', () => {
  it('places the first baseline from Liberation Sans hhea metrics', () => {
    expect(LIBERATION_SANS).toEqual({ ascender: 0.905, descender: 0.212 });
    expect(lineHeight(10)).toBeCloseTo(12);
    // (L − 1.117·s)/2 + 0.905·s with L = 1.2·s.
    expect(firstBaseline(10)).toBeCloseTo((12 - 11.17) / 2 + 9.05);
    expect(firstBaseline(36)).toBeCloseTo(0.9465 * 36);
  });
});

describe('overlayRect', () => {
  it('puts a text box with its first baseline on the anchor', () => {
    const r = overlayRect(page(), text(), 1);
    const a = pdfToScreen(page(), { x: 100, y: 700 }, 1);
    expect(r.left).toBeCloseTo(a.x);
    expect(r.top + firstBaseline(10) * K).toBeCloseTo(a.y);
    expect(r.height).toBeCloseTo(12 * K);
    expect(r.width).toBeGreaterThan(20);
  });

  it('grows with lines, and an empty text still has width', () => {
    expect(
      overlayRect(page(), text({ text: 'a\nb\nc' } as Partial<Overlay>), 1).height,
    ).toBeCloseTo(36 * K);
    expect(overlayRect(page(), text({ text: '' } as Partial<Overlay>), 1).width).toBeGreaterThan(0);
  });

  it('puts checks and signatures above their bottom-left anchor on every rotation', () => {
    for (const rotate of ROTATIONS) {
      const g = page(rotate);
      for (const o of [check, sig]) {
        const r = overlayRect(g, o, 2);
        const a = pdfToScreen(g, o, 2);
        expect(r.left).toBeCloseTo(a.x);
        expect(r.top + r.height).toBeCloseTo(a.y);
      }
      expect(overlayRect(g, sig, 1).width).toBeCloseTo(150 * K);
      expect(overlayRect(g, check, 1).height).toBeCloseTo(12 * K);
    }
  });
});

describe('placeOverlay', () => {
  it('puts text and date baselines on the click, snapped to 1 pt', () => {
    const t = placeOverlay('text', page(), { x: 100.4, y: 200.2 }, 1, defaults)!;
    expect(t).toMatchObject({ type: 'text', text: '', size: 10, bold: false, id: 'new', page: 0 });
    expect(Number.isInteger(t.x) && Number.isInteger(t.y)).toBe(true);
    expect(t.x).toBe(Math.round(100.4 / K));
    expect(t.y).toBe(Math.round(792 - 200.2 / K));
    const d = placeOverlay('date', page(), { x: 10, y: 10 }, 1, defaults)!;
    expect(d).toMatchObject({ type: 'date', text: '11/06/2026' });
  });

  it('clamps the default text size', () => {
    const t = placeOverlay('text', page(), { x: 0, y: 0 }, 1, { ...defaults, textSize: 99 });
    expect(t).toMatchObject({ size: 36 });
  });

  it('centres checks and signatures on the click on every rotation', () => {
    for (const rotate of ROTATIONS) {
      const g = page(rotate);
      const click = { x: 300, y: 400 };
      for (const tool of ['check', 'signature'] as const) {
        const o = placeOverlay(tool, g, click, 1, defaults)!;
        const r = overlayRect(g, o, 1);
        expect(Math.abs(r.left + r.width / 2 - click.x)).toBeLessThan(K);
        expect(Math.abs(r.top + r.height / 2 - click.y)).toBeLessThan(K);
      }
    }
  });

  it('places signatures 150 pt wide with the stored aspect ratio, and the chosen check mark', () => {
    expect(placeOverlay('signature', page(), { x: 0, y: 0 }, 1, defaults)).toMatchObject({
      width: 150,
      height: 50,
      signatureId: 'lib',
    });
    expect(placeOverlay('check', page(), { x: 0, y: 0 }, 1, defaults)).toMatchObject({
      glyph: 'x',
      size: 12,
    });
  });

  it('places no signature without one chosen', () => {
    expect(
      placeOverlay('signature', page(), { x: 0, y: 0 }, 1, { ...defaults, signature: null }),
    ).toBeNull();
    expect(
      placeOverlay('signature', page(), { x: 0, y: 0 }, 1, {
        ...defaults,
        signature: { id: 'x', width: 0, height: 10 },
      }),
    ).toBeNull();
  });
});

describe('moving and nudging', () => {
  it('moves with the drag on screen on every rotation, snapped', () => {
    for (const rotate of ROTATIONS) {
      const g = page(rotate);
      const before = pdfToScreen(g, sig, 1.5);
      const at = movedAnchor(g, sig, { x: 30, y: -20 }, 1.5);
      const after = pdfToScreen(g, at, 1.5);
      expect(Math.abs(after.x - before.x - 30)).toBeLessThan(1.5 * K);
      expect(Math.abs(after.y - before.y + 20)).toBeLessThan(1.5 * K);
      expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
    }
  });

  it('nudges in screen directions on rotated pages', () => {
    for (const rotate of ROTATIONS) {
      const g = page(rotate);
      const before = pdfToScreen(g, sig, 1);
      const right = pdfToScreen(g, nudgedAnchor(g, sig, 1, 0), 1);
      expect(right.x - before.x).toBeCloseTo(K);
      expect(right.y).toBeCloseTo(before.y);
      const down = pdfToScreen(g, nudgedAnchor(g, sig, 0, 10), 1);
      expect(down.y - before.y).toBeCloseTo(10 * K);
      expect(down.x).toBeCloseTo(before.x);
    }
  });
});

describe('resizing', () => {
  it('scales text size in whole points and keeps the top-left corner', () => {
    for (const rotate of ROTATIONS) {
      const g = page(rotate);
      const o = text();
      const r0 = overlayRect(g, o, 1);
      const patch = resizePatch(g, o, { x: r0.width, y: r0.height }, 1);
      expect(patch).toMatchObject({ size: 20 });
      const r1 = overlayRect(g, { ...o, ...patch } as Overlay, 1);
      expect(Math.abs(r1.left - r0.left)).toBeLessThan(K);
      expect(Math.abs(r1.top - r0.top)).toBeLessThan(K);
    }
  });

  it('clamps text and check sizes', () => {
    expect(resizePatch(page(), text(), { x: 5000, y: 5000 }, 1)).toMatchObject({ size: 36 });
    expect(resizePatch(page(), text(), { x: -5000, y: -5000 }, 1)).toMatchObject({ size: 6 });
    expect(resizePatch(page(), check, { x: 1000, y: 1000 }, 1)).toMatchObject({ size: 24 });
    expect(resizePatch(page(), check, { x: -1000, y: -1000 }, 1)).toMatchObject({ size: 8 });
  });

  it('keeps a signature’s aspect ratio and top edge, with a minimum width', () => {
    for (const rotate of ROTATIONS) {
      const g = page(rotate);
      const r0 = overlayRect(g, sig, 1);
      const patch = resizePatch(g, sig, { x: 150 * K, y: 0 }, 1);
      expect('width' in patch && patch.width / patch.height).toBeCloseTo(3);
      const r1 = overlayRect(g, { ...sig, ...patch } as Overlay, 1);
      expect(Math.abs(r1.top - r0.top)).toBeLessThan(K);
      expect(Math.abs(r1.left - r0.left)).toBeLessThan(K);
    }
    expect(resizePatch(page(), sig, { x: -1000, y: -1000 }, 1)).toMatchObject({
      width: MIN_SIGNATURE_WIDTH,
    });
  });

  it('sets sizes from the toolbar with the top-left corner kept', () => {
    const o = text();
    const patch = sizePatch(page(), o, 24)!;
    expect(patch.size).toBe(24);
    const r0 = overlayRect(page(), o, 1);
    const r1 = overlayRect(page(), { ...o, ...patch } as Overlay, 1);
    expect(Math.abs(r1.top - r0.top)).toBeLessThan(K);
    expect(sizePatch(page(), check, 30)).toMatchObject({ size: 24 });
    expect(sizePatch(page(), sig, 30)).toBeNull();
  });
});

describe('pointer helpers and labels', () => {
  it('counts a short, still press as a tap', () => {
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 3, y: 3, t: 200 })).toBe(true);
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 100 })).toBe(false);
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 500 })).toBe(false);
  });

  it('records the snapped page point under the pointer', () => {
    expect(pagePoint(page(), { x: 0, y: 0 }, 1)).toEqual({ x: 0, y: 792 });
  });

  it('names overlays for assistive technology', () => {
    expect(overlayLabel(text({ text: 'John  Smith\nJr', page: 1 } as Partial<Overlay>))).toBe(
      'Text overlay: John Smith Jr, page 2',
    );
    expect(overlayLabel(text({ text: '' } as Partial<Overlay>))).toBe(
      'Text overlay: empty, page 1',
    );
    expect(overlayLabel(text({ text: 'x'.repeat(80) } as Partial<Overlay>))).toContain('…');
    expect(overlayLabel({ ...text(), type: 'date', text: '1/2/2026' } as Overlay)).toBe(
      'Date overlay: 1/2/2026, page 1',
    );
    expect(overlayLabel(check)).toBe('Check mark overlay, page 1');
    expect(overlayLabel({ ...check, glyph: 'x' } as Overlay)).toBe('X mark overlay, page 1');
    expect(overlayLabel(sig, 'Tim')).toBe('Signature overlay: Tim, page 1');
    expect(overlayLabel(sig)).toBe('Signature overlay: deleted from the library, page 1');
  });
});

describe('check glyph', () => {
  it('puts the glyph origin where export draws it', () => {
    const u = ((1 - CHECK_GLYPH.advance) * BOX) / 2;
    const v = ((1 - CHECK_GLYPH.inkHeight) * BOX) / 2;
    expect(glyphTransform()).toBe(`translate(${u} ${BOX - v}) scale(1 -1)`);
    expect(A20_PATH.startsWith('M')).toBe(true);
    expect(A20_PATH.endsWith('Z')).toBe(true);
  });

  it('draws the X as two strokes across the inset box', () => {
    const { lines, width } = xStrokes();
    expect(lines).toEqual([
      [150, 150, 850, 850],
      [150, 850, 850, 150],
    ]);
    expect(width).toBe(100);
  });
});

describe('keys', () => {
  const ev = (key: string, over: Partial<KeyboardEvent> = {}) =>
    ({
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      ...over,
    }) as KeyboardEvent;
  const input = document.createElement('input');
  const button = document.createElement('button');

  it('maps tool letters and Escape, but not while typing or with modifiers', () => {
    expect(toolForKey(ev('t'))).toBe('text');
    expect(toolForKey(ev('C'))).toBe('check');
    expect(toolForKey(ev('d'))).toBe('date');
    expect(toolForKey(ev('s'))).toBe('signature');
    expect(toolForKey(ev('v'))).toBe('select');
    expect(toolForKey(ev('Escape'))).toBe('select');
    expect(toolForKey(ev('x'))).toBeNull();
    expect(toolForKey(ev('T', { shiftKey: true }))).toBeNull();
    expect(toolForKey(ev('t', { metaKey: true }))).toBeNull();
    expect(toolForKey(ev('t', { target: input }))).toBeNull();
    expect(toolForKey(ev('t', { target: button }))).toBe('text');
  });

  it('maps undo and redo outside text controls', () => {
    expect(historyKey(ev('z', { metaKey: true }))).toBe('undo');
    expect(historyKey(ev('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(historyKey(ev('y', { ctrlKey: true }))).toBe('redo');
    expect(historyKey(ev('y', { metaKey: true }))).toBeNull();
    expect(historyKey(ev('z'))).toBeNull();
    expect(historyKey(ev('z', { metaKey: true, altKey: true }))).toBeNull();
    expect(historyKey(ev('z', { metaKey: true, target: input }))).toBeNull();
    expect(historyKey(ev('a', { metaKey: true }))).toBeNull();
  });

  it('maps Delete and Backspace outside text controls', () => {
    expect(isDeleteKey(ev('Delete'))).toBe(true);
    expect(isDeleteKey(ev('Backspace'))).toBe(true);
    expect(isDeleteKey(ev('Backspace', { target: input }))).toBe(false);
    expect(isDeleteKey(ev('Backspace', { metaKey: true }))).toBe(false);
    expect(isDeleteKey(ev('a'))).toBe(false);
  });

  it('nudges 1 pt, or 10 with Shift', () => {
    expect(nudgeForKey(ev('ArrowLeft'))).toEqual({ right: -1, down: 0 });
    expect(nudgeForKey(ev('ArrowRight', { shiftKey: true }))).toEqual({ right: 10, down: 0 });
    expect(nudgeForKey(ev('ArrowUp'))).toEqual({ right: 0, down: -1 });
    expect(nudgeForKey(ev('ArrowDown'))).toEqual({ right: 0, down: 1 });
    expect(nudgeForKey(ev('ArrowDown', { metaKey: true }))).toBeNull();
    expect(nudgeForKey(ev('a'))).toBeNull();
  });

  it('knows when focus is inside a dialog', () => {
    const dialog = document.createElement('dialog');
    dialog.append(button);
    expect(inDialog(button)).toBe(true);
    expect(inDialog(input)).toBe(false);
    expect(inDialog(null)).toBe(false);
  });
});
