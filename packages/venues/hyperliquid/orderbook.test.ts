import { describe, expect, it } from 'vitest';
import type { MarketQuote } from '@arbitrage-scanner/core';
import { HyperliquidLocalOrderBook } from './orderbook.js';

const market: MarketQuote = {
  id: 'hyperliquid:perpetual:BTC',
  venue: { id: 'hyperliquid', name: 'Hyperliquid', kind: 'dex' },
  marketType: 'perpetual', symbol: 'BTC-USD',
  baseAsset: { symbol: 'BTC' }, quoteAsset: { symbol: 'USD' }, observedAt: new Date(1_000),
};

describe('HyperliquidLocalOrderBook', () => {
  it('replaces its shared level store on each full L2 snapshot', () => {
    const book = new HyperliquidLocalOrderBook();
    book.push({ channel: 'l2Book', data: {
      coin: 'BTC', time: 1_000,
      levels: [
        [{ px: '99', sz: '2', n: 1 }, { px: '98', sz: '3', n: 2 }],
        [{ px: '101', sz: '4', n: 1 }],
      ],
    } });
    expect(book.bestPrices()).toEqual({ bestBid: '99', bestAsk: '101' });

    book.push({ channel: 'l2Book', data: {
      coin: 'BTC', time: 2_000,
      levels: [[{ px: '97', sz: '5', n: 1 }], [{ px: '103', sz: '6', n: 1 }]],
    } });
    const normalized = book.toOrderBook(market);
    expect(normalized?.bids.map((level) => level.price.toString())).toEqual(['97']);
    expect(normalized?.asks.map((level) => level.price.toString())).toEqual(['103']);
  });

  it('detects stale snapshots', () => {
    const book = new HyperliquidLocalOrderBook();
    expect(book.isStale(1_000, 500)).toBe(true);
    book.push({ channel: 'l2Book', data: { coin: 'BTC', time: 1_000, levels: [[], []] } });
    expect(book.isStale(1_500, 500)).toBe(false);
    expect(book.isStale(1_501, 500)).toBe(true);
  });
});

