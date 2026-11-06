// The viewer's pure parts: zoom, canvas sizing, page windows, keys, the render queue and the LRU.
import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/config.ts';
import { canvasSize, releaseCanvas } from '../src/features/viewer/canvasSize.ts';
import { isTyping, pageStep } from '../src/features/viewer/keys.ts';
import { annotationRendering, clampPage, pagesAround } from '../src/features/viewer/pageModel.ts';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  PAGE_GUTTER,
  resolveZoom,
  stepZoom,
  ZOOM_CHOICES,
  zoomLabel,
  zoomValue,
} from '../src/features/viewer/zoom.ts';
import { Lru } from '../src/pdfjs/lru.ts';
import { RenderQueue, type Timers } from '../src/pdfjs/renderQueue.ts';
import { RenderCancelled, RenderTimedOut, type RenderJob } from '../src/pdfjs/types.ts';

const letter = { width: 816, height: 1056 };

describe('zoom (V3, spec §5.1)', () => {
  it('clamps numeric zoom to 50–300%', () => {
    expect(resolveZoom(1.25, letter, { width: 10, height: 10 })).toBe(1.25);
    expect(resolveZoom(0.1, letter, { width: 10, height: 10 })).toBe(MIN_ZOOM);
    expect(resolveZoom(9, letter, { width: 10, height: 10 })).toBe(MAX_ZOOM);
  });

  it('fits the width or the whole page inside the gutter', () => {
    const area = { width: 816 + 2 * PAGE_GUTTER, height: 528 + 2 * PAGE_GUTTER };
    expect(resolveZoom('fit-width', letter, area)).toBeCloseTo(1, 10);
    expect(resolveZoom('fit-page', letter, area)).toBeCloseTo(0.5, 10);
    expect(resolveZoom('fit-width', letter, { width: 0, height: 0 })).toBe(0.1);
    expect(resolveZoom('fit-page', letter, { width: 1e5, height: 1e5 })).toBe(MAX_ZOOM);
  });

  it('steps through the presets from whatever is shown', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(3, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(0.3, -1)).toBe(MIN_ZOOM);
  });

  it('labels and keys every choice', () => {
    expect(ZOOM_CHOICES.map(zoomLabel)).toEqual([
      'Fit width',
      'Fit page',
      '50%',
      '75%',
      '100%',
      '125%',
      '150%',
      '200%',
      '250%',
      '300%',
    ]);
    expect(zoomValue('fit-page')).toBe('fit-page');
    expect(zoomValue(1.37)).toBe('137');
  });
});

describe('canvas size (V1, spec §10.3)', () => {
  it('multiplies by the device pixel ratio', () => {
    expect(canvasSize(100.6, 50.2, 2, LIMITS.maxCanvasPixels)).toEqual({ width: 201, height: 100 });
    expect(canvasSize(100, 50, Number.NaN, LIMITS.maxCanvasPixels)).toEqual({
      width: 100,
      height: 50,
    });
    expect(canvasSize(0, 0, 2, LIMITS.maxCanvasPixels)).toEqual({ width: 1, height: 1 });
  });

  it('caps the backing store at 16.7 MP and keeps the proportions', () => {
    const { width, height } = canvasSize(816 * 3, 1056 * 3, 3, LIMITS.maxCanvasPixels);
    expect(width * height).toBeLessThanOrEqual(LIMITS.maxCanvasPixels);
    expect(width * height).toBeGreaterThan(LIMITS.maxCanvasPixels * 0.99);
    expect(width / height).toBeCloseTo(816 / 1056, 3);
  });

  it('releases a canvas by shrinking it to nothing', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    releaseCanvas(canvas);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });
});

describe('page model', () => {
  it('leaves widgets out only on AcroForm documents (spec §10.3)', () => {
    expect(annotationRendering('acroform')).toBe('without-form-widgets');
    expect(annotationRendering('flat')).toBe('all');
    expect(annotationRendering('xfa')).toBe('all');
    expect(annotationRendering(undefined)).toBe('all');
  });

  it('keeps the current page and its neighbors (V6)', () => {
    expect(pagesAround(0, 5, 1)).toEqual([0, 1]);
    expect(pagesAround(2, 5, 1)).toEqual([1, 2, 3]);
    expect(pagesAround(4, 5, 1)).toEqual([3, 4]);
    expect(pagesAround(0, 1, 1)).toEqual([0]);
  });

  it('clamps a page into the document', () => {
    expect(clampPage(-1, 3)).toBe(0);
    expect(clampPage(5, 3)).toBe(2);
    expect(clampPage(1, 0)).toBe(0);
  });
});

describe('keys (U2)', () => {
  const key = (init: Partial<KeyboardEvent> & { key: string }, target: EventTarget | null = null) =>
    ({ metaKey: false, ctrlKey: false, altKey: false, target, ...init }) as KeyboardEvent;

  it('treats text controls as typing and other targets as not', () => {
    const input = document.createElement('input');
    expect(isTyping(input)).toBe(true);
    input.type = 'checkbox';
    expect(isTyping(input)).toBe(false);
    expect(isTyping(document.createElement('textarea'))).toBe(true);
    expect(isTyping(document.createElement('select'))).toBe(true);
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTyping(editable)).toBe(true);
    expect(isTyping(document.createElement('button'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it('pages with [ and ] unless typing or modified', () => {
    expect(pageStep(key({ key: '[' }))).toBe(-1);
    expect(pageStep(key({ key: ']' }))).toBe(1);
    expect(pageStep(key({ key: 'x' }))).toBe(0);
    expect(pageStep(key({ key: ']', metaKey: true }))).toBe(0);
    expect(pageStep(key({ key: ']' }, document.createElement('input')))).toBe(0);
  });
});

/** A render job that settles when the test says so. */
function deferredJob() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const job = { promise, cancel: vi.fn(() => reject(new Error('cancelled'))) } satisfies RenderJob;
  return { job, resolve, reject };
}

function manualTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    setTimeout: (run) => {
      pending.set(++next, run);
      return next;
    },
    clearTimeout: (handle) => pending.delete(handle as number),
  };
  return { timers, pending, fireAll: () => [...pending.values()].forEach((run) => run()) };
}

describe('render queue (spec §10.3)', () => {
  it('runs at most two renders at once, current page first', async () => {
    const queue = new RenderQueue(2, 1000, manualTimers().timers);
    const started: string[] = [];
    const jobs = new Map<string, ReturnType<typeof deferredJob>>();
    const enqueue = (name: string, priority: number) =>
      queue.enqueue(() => {
        started.push(name);
        const deferred = deferredJob();
        jobs.set(name, deferred);
        return deferred.job;
      }, priority);

    const a = enqueue('thumb-a', 2);
    const b = enqueue('thumb-b', 2);
    enqueue('thumb-c', 2);
    enqueue('neighbor', 1);
    const page = enqueue('page', 0);
    expect(started).toEqual(['thumb-a', 'thumb-b']);
    expect(queue.size).toBe(5);

    jobs.get('thumb-a')!.resolve();
    await a.promise;
    expect(started).toEqual(['thumb-a', 'thumb-b', 'page']);
    jobs.get('thumb-b')!.resolve();
    await b.promise;
    expect(started.at(-1)).toBe('neighbor');
    jobs.get('page')!.resolve();
    await page.promise;
    expect(started.at(-1)).toBe('thumb-c');
  });

  it('never starts a cancelled render and cancels a running one', async () => {
    const queue = new RenderQueue(1, 1000, manualTimers().timers);
    const first = deferredJob();
    const start = vi.fn(() => deferredJob().job);
    const running = queue.enqueue(() => first.job);
    const waiting = queue.enqueue(start);
    waiting.cancel();
    await expect(waiting.promise).rejects.toBeInstanceOf(RenderCancelled);
    running.cancel();
    running.cancel();
    await expect(running.promise).rejects.toBeInstanceOf(RenderCancelled);
    expect(first.job.cancel).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(queue.size).toBe(0);
  });

  it('stops a render that runs past the timeout (spec §11.4)', async () => {
    const { timers, fireAll } = manualTimers();
    const queue = new RenderQueue(2, 20_000, timers);
    const slow = deferredJob();
    const job = queue.enqueue(() => slow.job);
    fireAll();
    await expect(job.promise).rejects.toBeInstanceOf(RenderTimedOut);
    expect(slow.job.cancel).toHaveBeenCalled();
  });

  it('passes on failures, including a render that throws when started', async () => {
    const queue = new RenderQueue(2, 1000);
    const failing = deferredJob();
    const job = queue.enqueue(() => failing.job);
    failing.reject(new Error('bad page'));
    await expect(job.promise).rejects.toThrow('bad page');
    const throwing = queue.enqueue(() => {
      throw 'not an error';
    });
    await expect(throwing.promise).rejects.toThrow('not an error');
    const fine = deferredJob();
    const after = queue.enqueue(() => fine.job);
    fine.resolve();
    await expect(after.promise).resolves.toBeUndefined();
  });
});

describe('LRU (spec §10.3)', () => {
  it('evicts the least recently used entry and reports it', () => {
    const evicted: string[] = [];
    const lru = new Lru<number, string>(2, (value, key) => evicted.push(`${key}:${value}`));
    lru.set(1, 'a');
    lru.set(2, 'b');
    expect(lru.get(1)).toBe('a');
    lru.set(3, 'c');
    expect(evicted).toEqual(['2:b']);
    expect(lru.get(2)).toBeUndefined();
    lru.set(1, 'a2');
    expect(evicted).toEqual(['2:b', '1:a']);
    lru.set(1, 'a2');
    expect(evicted).toHaveLength(2);
    expect(lru.size).toBe(2);
    lru.clear();
    expect(evicted).toEqual(['2:b', '1:a', '3:c', '1:a2']);
    expect(lru.size).toBe(0);
  });

  it('works without an eviction callback', () => {
    const lru = new Lru<string, number>(1);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBeUndefined();
  });
});
