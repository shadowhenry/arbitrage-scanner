import { describe, expect, it, vi } from 'vitest';
import { PolymarketAdapter } from './client.js';
import type { PolymarketFetch } from './types.js';

const gammaMarket = {
  id: '42', question: 'Will the test pass?', conditionId: 'condition-1', slug: 'test-pass',
  endDateIso: '2027-01-01T00:00:00Z', outcomes: '["Yes", "No"]',
  clobTokenIds: '["yes-token", "no-token"]', active: true, closed: false,
  enableOrderBook: true, acceptingOrders: true, feesEnabled: true,
  feeSchedule: { exponent: 1, rate: 0.04, takerOnly: true, rebateRate: 0.25 },
};

function book(assetId: string, yes: boolean) {
  return {
    market: 'condition-1', asset_id: assetId, timestamp: '1760000000000', hash: `${assetId}-hash`,
    bids: [{ price: yes ? '0.40' : '0.42', size: '100' }],
    asks: [{ price: yes ? '0.45' : '0.46', size: '150' }],
    min_order_size: '1', tick_size: '0.01', neg_risk: false, last_trade_price: '0.44',
  };
}

describe('PolymarketAdapter', () => {
  it('discovers binary markets and loads YES/NO books, metadata and fees', async () => {
    const requests: { readonly url: URL; readonly init?: RequestInit }[] = [];
    const request: PolymarketFetch = vi.fn(async (input, init) => {
      const url = new URL(input);
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      if (url.hostname.startsWith('gamma')) return new Response(JSON.stringify([gammaMarket]));
      if (url.pathname === '/books') return new Response(JSON.stringify([
        book('no-token', false), book('yes-token', true),
      ]));
      if (url.pathname.startsWith('/clob-markets/')) {
        return new Response(JSON.stringify({ fd: { r: 0.04, e: 1, to: true } }));
      }
      return new Response(JSON.stringify({ base_fee: 40 }));
    });
    const adapter = new PolymarketAdapter({ fetch: request, now: () => 1_760_000_000_000 });

    const markets = await adapter.discoverMarkets({ limit: 25 });
    const discovered = markets[0];
    expect(discovered?.market.question).toBe('Will the test pass?');
    expect(discovered?.market.resolvesAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(discovered?.yesTokenId).toBe('yes-token');
    if (discovered === undefined) throw new Error('fixture market missing');
    const snapshot = await adapter.getBinarySnapshot(discovered);

    expect(snapshot.yesOrderBook.asks[0]?.price.toString()).toBe('0.45');
    expect(snapshot.noOrderBook.asks[0]?.price.toString()).toBe('0.46');
    expect(snapshot.yesOrderBook.market.id).toContain(':YES');
    expect(snapshot.noOrderBook.market.id).toContain(':NO');
    expect(snapshot.yesFee.takerFeeRate.toString()).toBe('0.04');
    const booksRequest = requests.find(({ url }) => url.pathname === '/books');
    expect(booksRequest?.init?.method).toBe('POST');
    expect(requests.every(({ url }) => !url.pathname.includes('/order'))).toBe(true);
  });

  it('filters non-binary and non-orderbook discovery results', async () => {
    const request: PolymarketFetch = vi.fn(async () => new Response(JSON.stringify([
      { ...gammaMarket, enableOrderBook: false },
      { ...gammaMarket, conditionId: 'multi', outcomes: '["A","B","C"]', clobTokenIds: '["1","2","3"]' },
    ])));
    const adapter = new PolymarketAdapter({ fetch: request });
    await expect(adapter.discoverMarkets()).resolves.toEqual([]);
  });
});
