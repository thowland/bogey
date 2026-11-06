// A small least-recently-used cache. The thumbnail strip keeps its ImageBitmaps here (spec §10.3,
// V2), closing each one as it is evicted so the browser frees its pixels.

export class Lru<K, V> {
  readonly #capacity: number;
  readonly #onEvict: (value: V, key: K) => void;
  readonly #entries = new Map<K, V>();

  constructor(capacity: number, onEvict: (value: V, key: K) => void = () => undefined) {
    this.#capacity = capacity;
    this.#onEvict = onEvict;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Returns the value and marks it as most recently used. */
  get(key: K): V | undefined {
    if (!this.#entries.has(key)) return undefined;
    const value = this.#entries.get(key)!;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.#entries.has(key)) {
      const previous = this.#entries.get(key)!;
      this.#entries.delete(key);
      if (previous !== value) this.#onEvict(previous, key);
    }
    this.#entries.set(key, value);
    while (this.#entries.size > this.#capacity) {
      const [oldestKey, oldest] = this.#entries.entries().next().value!;
      this.#entries.delete(oldestKey);
      this.#onEvict(oldest, oldestKey);
    }
  }

  /** Evicts everything. */
  clear(): void {
    const entries = [...this.#entries];
    this.#entries.clear();
    for (const [key, value] of entries) this.#onEvict(value, key);
  }
}
