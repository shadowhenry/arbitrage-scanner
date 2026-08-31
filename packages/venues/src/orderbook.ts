import { Decimal, type MarketQuote, type OrderBook, type OrderBookLevel } from '@arbitrage-scanner/core';

export type RawOrderBookLevel = readonly [price: string, quantity: string];

/** Venue-agnostic price-level storage. Sequence and synchronization rules stay in each venue adapter. */
export class MutableOrderBook {
  readonly #bids = new Map<string, Decimal>();
  readonly #asks = new Map<string, Decimal>();

  clear(): void {
    this.#bids.clear();
    this.#asks.clear();
  }

  replace(bids: readonly RawOrderBookLevel[], asks: readonly RawOrderBookLevel[]): void {
    this.clear();
    this.apply(bids, asks);
  }

  apply(bids: readonly RawOrderBookLevel[], asks: readonly RawOrderBookLevel[]): void {
    this.#applySide(this.#bids, bids);
    this.#applySide(this.#asks, asks);
  }

  toNormalized(
    market: MarketQuote,
    observedAt: Date,
    sequence: string,
    limit = 5_000,
  ): OrderBook {
    return {
      market,
      bids: this.#sorted(this.#bids, 'desc', limit),
      asks: this.#sorted(this.#asks, 'asc', limit),
      observedAt,
      sequence,
    };
  }

  #applySide(side: Map<string, Decimal>, levels: readonly RawOrderBookLevel[]): void {
    for (const [rawPrice, rawQuantity] of levels) {
      const price = new Decimal(rawPrice);
      const quantity = new Decimal(rawQuantity);
      if (!price.isFinite() || !price.greaterThan(0) || !quantity.isFinite() || quantity.isNegative()) {
        throw new RangeError('Order-book levels require a positive price and non-negative quantity');
      }
      const key = price.toString();
      if (quantity.isZero()) side.delete(key);
      else side.set(key, quantity);
    }
  }

  #sorted(side: Map<string, Decimal>, direction: 'asc' | 'desc', limit: number): OrderBookLevel[] {
    return [...side.entries()]
      .map(([price, quantity]) => ({ price: new Decimal(price), quantity }))
      .sort((left, right) => direction === 'asc'
        ? left.price.comparedTo(right.price)
        : right.price.comparedTo(left.price))
      .slice(0, limit);
  }
}

