import { describe, expect, it } from 'vitest';
import type { MarketQuote } from '@arbitrage-scanner/core';
import { BybitLocalOrderBook } from './orderbook.js';
import type { BybitOrderBookEvent } from './types.js';

const market: MarketQuote = {
  id: 'bybit:spot:BTCUSDT',
  venue: { id: 'bybit', name: 'Bybit', kind: 'cex' },
  marketType: 'spot', symbol: 'BTCUSDT',
  baseAsset: { symbol: 'BTC' }, quoteAsset: { symbol: 'USDT' },
  observedAt: new Date(1_000),
};

const event = (overrides: Partial<BybitOrderBookEvent> = {}): BybitOrderBookEvent => ({
  topic: 'orderbook.50.BTCUSDT', type: 'snapshot', ts: 1_000, cts: 999,
  data: { s: 'BTCUSDT', b: [['99', '2']], a: [['101', '3']], u: 10, seq: 100 },
  ...overrides,
});

describe('BybitLocalOrderBook', () => {
  it('replaces state on every snapshot', () => {
    const book = new BybitLocalOrderBook();
    expect(book.push(event())).toBe('snapshot');
    expect(book.push(event({
      ts: 2_000,
      data: { s: 'BTCUSDT', b: [['98', '4']], a: [['102', '5']], u: 20, seq: 200 },
    }))).toBe('snapshot');

    const normalized = book.toOrderBook(market);
    expect(normalized?.bids.map((level) => level.price.toString())).toEqual(['98']);
    expect(normalized?.asks.map((level) => level.price.toString())).toEqual(['102']);
    expect(normalized?.sequence).toBe('20:200');
  });

  it('applies delta insertions, updates, and deletions using shared level storage', () => {
    const book = new BybitLocalOrderBook();
    book.push(event());
    expect(book.push(event({
      type: 'delta', ts: 1_100,
      data: { s: 'BTCUSDT', b: [['99', '0'], ['98', '7']], a: [['101', '4']], u: 11, seq: 101 },
    }))).toBe('applied');

    const normalized = book.toOrderBook(market);
    expect(normalized?.bids.map((level) => level.price.toString())).toEqual(['98']);
    expect(normalized?.asks[0]?.quantity.toString()).toBe('4');
  });

  it('ignores duplicate and out-of-order update or cross sequence IDs', () => {
    const book = new BybitLocalOrderBook();
    book.push(event());
    expect(book.push(event({ type: 'delta', data: { ...event().data, u: 10, seq: 101 } }))).toBe('ignored');
    expect(book.push(event({ type: 'delta', data: { ...event().data, u: 11, seq: 99 } }))).toBe('ignored');
  });

  it('waits for a snapshot after restart update ID 1', () => {
    const book = new BybitLocalOrderBook();
    book.push(event());
    expect(book.push(event({ type: 'delta', data: { ...event().data, u: 1, seq: 101 } })))
      .toBe('awaiting-snapshot');
    expect(book.synchronized).toBe(false);
  });

  it('does not apply deltas before a snapshot', () => {
    const book = new BybitLocalOrderBook();
    expect(book.push(event({ type: 'delta' }))).toBe('awaiting-snapshot');
    expect(book.toOrderBook(market)).toBeUndefined();
  });

  it('detects stale orderbook data', () => {
    const book = new BybitLocalOrderBook();
    book.push(event({ ts: 1_000, cts: 900 }));
    expect(book.isStale(1_500, 1_000)).toBe(false);
    expect(book.isStale(1_901, 1_000)).toBe(true);
  });
});

