import { describe, expect, it } from 'vitest';
import { Decimal, type MarketQuote } from '@arbitrage-scanner/core';
import { BinanceLocalOrderBook } from './orderbook.js';
import type { BinanceDepthEvent, BinanceDepthSnapshot } from './types.js';

const market: MarketQuote = {
  id: 'binance:spot:BTCUSDT',
  venue: { id: 'binance', name: 'Binance', kind: 'cex' },
  marketType: 'spot',
  symbol: 'BTCUSDT',
  baseAsset: { symbol: 'BTC' },
  quoteAsset: { symbol: 'USDT' },
  observedAt: new Date(1_000),
};

const snapshot: BinanceDepthSnapshot = {
  lastUpdateId: 100,
  bids: [['99', '2'], ['98', '3']],
  asks: [['101', '2'], ['102', '3']],
};

const event = (overrides: Partial<BinanceDepthEvent> = {}): BinanceDepthEvent => ({
  e: 'depthUpdate', E: 2_000, s: 'BTCUSDT', U: 101, u: 102,
  b: [['99', '1']], a: [['101', '0'], ['103', '4']], ...overrides,
});

describe('BinanceLocalOrderBook snapshot synchronization', () => {
  it('buffers events, aligns a snapshot, updates and deletes levels', () => {
    const book = new BinanceLocalOrderBook('spot');
    expect(book.push(event())).toBe('buffered');
    expect(book.synchronize(snapshot)).toBe(true);

    const normalized = book.toOrderBook(market);
    expect(normalized?.sequence).toBe('102');
    expect(normalized?.bids.map((item) => [item.price.toString(), item.quantity.toString()]))
      .toEqual([['99', '1'], ['98', '3']]);
    expect(normalized?.asks.map((item) => item.price.toString())).toEqual(['102', '103']);
  });

  it('rejects a snapshot older than the first buffered update range', () => {
    const book = new BinanceLocalOrderBook('spot');
    book.push(event({ U: 105, u: 106 }));
    expect(book.synchronize(snapshot)).toBe(false);
    expect(book.synchronized).toBe(false);
    expect(book.bufferedEventCount).toBe(1);
  });

  it('discards buffered events already covered by the snapshot', () => {
    const book = new BinanceLocalOrderBook('spot');
    book.push(event({ U: 90, u: 99 }));
    expect(book.synchronize(snapshot)).toBe(true);
    expect(book.lastUpdateId).toBe(100);
  });
});

describe('BinanceLocalOrderBook sequence validation', () => {
  it('ignores duplicate updates', () => {
    const book = new BinanceLocalOrderBook('spot');
    book.synchronize(snapshot);
    expect(book.push(event({ U: 90, u: 100 }))).toBe('ignored');
  });

  it('requires resynchronization after a Spot sequence gap', () => {
    const book = new BinanceLocalOrderBook('spot');
    book.synchronize(snapshot);
    expect(book.push(event({ U: 102, u: 103 }))).toBe('resync-required');
    expect(book.synchronized).toBe(false);
    expect(book.bufferedEventCount).toBe(1);
  });

  it('validates Futures previous-final-update IDs', () => {
    const book = new BinanceLocalOrderBook('futures');
    book.synchronize(snapshot);
    expect(book.push(event({ pu: 99 }))).toBe('resync-required');
  });

  it('accepts a Futures bridging event even when pu predates the snapshot', () => {
    const book = new BinanceLocalOrderBook('futures');
    book.push(event({ U: 95, u: 102, pu: 94 }));
    expect(book.synchronize(snapshot)).toBe(true);
    expect(book.lastUpdateId).toBe(102);
  });
});

describe('BinanceLocalOrderBook state', () => {
  it('sorts bids descending and asks ascending', () => {
    const book = new BinanceLocalOrderBook('spot');
    book.synchronize(snapshot);
    const normalized = book.toOrderBook(market);
    expect(normalized?.bids[0]?.price.equals(new Decimal(99))).toBe(true);
    expect(normalized?.asks[0]?.price.equals(new Decimal(101))).toBe(true);
  });

  it('detects stale and current data', () => {
    const book = new BinanceLocalOrderBook('spot');
    expect(book.isStale(2_000, 1_000)).toBe(true);
    book.push(event({ E: 2_000 }));
    expect(book.isStale(2_500, 1_000)).toBe(false);
    expect(book.isStale(3_001, 1_000)).toBe(true);
  });

  it('rejects malformed levels', () => {
    const book = new BinanceLocalOrderBook('spot');
    expect(() => book.synchronize({ ...snapshot, bids: [['0', '1']] })).toThrow(RangeError);
    expect(() => book.synchronize({ ...snapshot, asks: [['1', '-1']] })).toThrow(RangeError);
  });
});

