import type { MarketQuote, OrderBook } from '@arbitrage-scanner/core';
import { MutableOrderBook } from '../src/orderbook.js';
import type { HyperliquidL2BookMessage } from './types.js';

export class HyperliquidLocalOrderBook {
  readonly #levels = new MutableOrderBook();
  #lastEventAt: number | null = null;

  push(message: HyperliquidL2BookMessage): void {
    const [bids, asks] = message.data.levels;
    this.#levels.replace(
      bids.map((level) => [level.px, level.sz] as const),
      asks.map((level) => [level.px, level.sz] as const),
    );
    this.#lastEventAt = message.data.time;
  }

  isStale(now = Date.now(), staleAfterMs = 5_000): boolean {
    return this.#lastEventAt === null || now - this.#lastEventAt > staleAfterMs;
  }

  bestPrices(): { bestBid?: string; bestAsk?: string } {
    if (this.#lastEventAt === null) return {};
    const placeholder: MarketQuote = {
      id: 'internal', venue: { id: 'internal', name: 'Internal', kind: 'dex' },
      marketType: 'spot', symbol: 'INTERNAL',
      baseAsset: { symbol: 'BASE' }, quoteAsset: { symbol: 'QUOTE' },
      observedAt: new Date(this.#lastEventAt),
    };
    const book = this.#levels.toNormalized(placeholder, placeholder.observedAt, String(this.#lastEventAt), 1);
    return {
      ...(book.bids[0] === undefined ? {} : { bestBid: book.bids[0].price.toString() }),
      ...(book.asks[0] === undefined ? {} : { bestAsk: book.asks[0].price.toString() }),
    };
  }

  toOrderBook(market: MarketQuote, limit = 20): OrderBook | undefined {
    if (this.#lastEventAt === null) return undefined;
    return this.#levels.toNormalized(
      market,
      new Date(this.#lastEventAt),
      String(this.#lastEventAt),
      limit,
    );
  }
}

