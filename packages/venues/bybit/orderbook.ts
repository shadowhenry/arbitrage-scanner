import type { MarketQuote, OrderBook } from '@arbitrage-scanner/core';
import { MutableOrderBook } from '../src/orderbook.js';
import type { BybitBookResult, BybitOrderBookEvent } from './types.js';

export class BybitLocalOrderBook {
  readonly #levels = new MutableOrderBook();
  #updateId: number | null = null;
  #sequence: number | null = null;
  #lastEventAt: number | null = null;

  get synchronized(): boolean {
    return this.#updateId !== null;
  }

  get updateId(): number | null {
    return this.#updateId;
  }

  get sequence(): number | null {
    return this.#sequence;
  }

  push(event: BybitOrderBookEvent): BybitBookResult {
    this.#lastEventAt = event.cts ?? event.ts;
    const { u, seq, b, a } = event.data;

    if (event.type === 'snapshot') {
      this.#levels.replace(b, a);
      this.#updateId = u;
      this.#sequence = seq;
      return 'snapshot';
    }

    if (!this.synchronized || u === 1) {
      this.reset();
      return 'awaiting-snapshot';
    }
    if (u <= (this.#updateId ?? 0) || seq <= (this.#sequence ?? 0)) return 'ignored';

    this.#levels.apply(b, a);
    this.#updateId = u;
    this.#sequence = seq;
    return 'applied';
  }

  reset(): void {
    this.#levels.clear();
    this.#updateId = null;
    this.#sequence = null;
  }

  isStale(now = Date.now(), staleAfterMs = 5_000): boolean {
    return this.#lastEventAt === null || now - this.#lastEventAt > staleAfterMs;
  }

  toOrderBook(market: MarketQuote, limit = 50): OrderBook | undefined {
    if (this.#updateId === null || this.#sequence === null) return undefined;
    return this.#levels.toNormalized(
      market,
      new Date(this.#lastEventAt ?? market.observedAt.getTime()),
      `${this.#updateId}:${this.#sequence}`,
      limit,
    );
  }
}

