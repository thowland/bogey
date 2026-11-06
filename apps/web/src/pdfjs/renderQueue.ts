// The render queue (spec §10.3): at most `limit` renders run at once, lower priority numbers start
// first, a render nobody wants any more is cancelled (queued ones never start), and a render that
// runs past the timeout is cancelled and reported (spec §11.4).
import { RenderCancelled, RenderTimedOut, type RenderJob } from './types.ts';

export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface Entry {
  start: () => RenderJob;
  priority: number;
  order: number;
  resolve(): void;
  reject(error: Error): void;
  running: RenderJob | null;
  timer: unknown;
  settled: boolean;
}

export class RenderQueue {
  readonly #limit: number;
  readonly #timeoutMs: number;
  readonly #timers: Timers;
  #waiting: Entry[] = [];
  #running = new Set<Entry>();
  #order = 0;

  constructor(
    limit: number,
    timeoutMs: number,
    timers: Timers = {
      setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
    },
  ) {
    this.#limit = limit;
    this.#timeoutMs = timeoutMs;
    this.#timers = timers;
  }

  /** Renders running or waiting. */
  get size(): number {
    return this.#running.size + this.#waiting.length;
  }

  /** Queues a render. 0 is the page in view; larger numbers wait behind it. */
  enqueue(start: () => RenderJob, priority = 0): RenderJob {
    let entry!: Entry;
    const promise = new Promise<void>((resolve, reject) => {
      entry = {
        start,
        priority,
        order: this.#order++,
        resolve,
        reject,
        running: null,
        timer: undefined,
        settled: false,
      };
    });
    this.#waiting.push(entry);
    this.#pump();
    return { promise, cancel: () => this.#abandon(entry, new RenderCancelled()) };
  }

  #pump(): void {
    while (this.#running.size < this.#limit && this.#waiting.length > 0) {
      this.#waiting.sort((a, b) => a.priority - b.priority || a.order - b.order);
      const entry = this.#waiting.shift()!;
      this.#run(entry);
    }
  }

  #run(entry: Entry): void {
    this.#running.add(entry);
    let job: RenderJob;
    try {
      job = entry.start();
    } catch (error) {
      this.#settle(entry, () => entry.reject(asError(error)));
      return;
    }
    entry.running = job;
    entry.timer = this.#timers.setTimeout(
      () => this.#abandon(entry, new RenderTimedOut()),
      this.#timeoutMs,
    );
    job.promise.then(
      () => this.#settle(entry, () => entry.resolve()),
      (error: unknown) => this.#settle(entry, () => entry.reject(asError(error))),
    );
  }

  /** Cancels a waiting or running render and rejects it with `reason`. */
  #abandon(entry: Entry, reason: Error): void {
    if (entry.settled) return;
    const index = this.#waiting.indexOf(entry);
    if (index >= 0) this.#waiting.splice(index, 1);
    entry.running?.cancel();
    this.#settle(entry, () => entry.reject(reason));
  }

  #settle(entry: Entry, finish: () => void): void {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.timer !== undefined) this.#timers.clearTimeout(entry.timer);
    this.#running.delete(entry);
    finish();
    this.#pump();
  }
}

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));
