interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: Promise<T>;
}

export class TtlPromiseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new RangeError('cacheTtlMs must be non-negative');
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('cacheMaxEntries must be positive');
  }

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const timestamp = this.now();
    const existing = this.entries.get(key);
    if (existing !== undefined && existing.expiresAt > timestamp) return existing.value;
    if (existing !== undefined) this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    const value = factory();
    this.entries.set(key, { expiresAt: timestamp + this.ttlMs, value });
    void value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
