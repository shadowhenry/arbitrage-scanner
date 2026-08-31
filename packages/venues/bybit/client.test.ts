import { describe, expect, it, vi } from 'vitest';
import { BybitLinearAdapter } from './linear.js';
import { BybitSpotAdapter } from './spot.js';

const orderbook = JSON.stringify({
  topic: 'orderbook.50.BTCUSDT', type: 'snapshot', ts: 1_000,
  data: { s: 'BTCUSDT', b: [['99', '2']], a: [['101', '3']], u: 10, seq: 100 },
});

describe('Bybit adapters', () => {
  it('emits normalized Spot ticker and orderbook state', () => {
    const onState = vi.fn();
    const adapter = new BybitSpotAdapter({ symbols: ['BTCUSDT'], onState, staleAfterMs: 5_000 });
    adapter.handleMessage(orderbook);
    adapter.handleMessage(JSON.stringify({
      topic: 'tickers.BTCUSDT', type: 'snapshot', ts: 1_100,
      data: { symbol: 'BTCUSDT', lastPrice: '100', bid1Price: '99', ask1Price: '101' },
    }));

    const state = adapter.getState('BTCUSDT', 1_200);
    expect(state?.quote.marketType).toBe('spot');
    expect(state?.orderBook?.bids[0]?.price.toString()).toBe('99');
    expect(state?.stale).toBe(false);
    expect(onState).toHaveBeenCalled();
  });

  it('merges Linear ticker deltas before normalization', () => {
    const adapter = new BybitLinearAdapter({ symbols: ['BTCUSDT'], onState: vi.fn() });
    adapter.handleMessage(orderbook);
    adapter.handleMessage(JSON.stringify({
      topic: 'tickers.BTCUSDT', type: 'snapshot', ts: 1_100,
      data: {
        symbol: 'BTCUSDT', lastPrice: '100', bid1Price: '99', ask1Price: '101',
        markPrice: '100.1', indexPrice: '100.2', fundingRate: '0.0001',
        fundingIntervalHour: '8', nextFundingTime: '3000',
      },
    }));
    adapter.handleMessage(JSON.stringify({
      topic: 'tickers.BTCUSDT', type: 'delta', ts: 1_200,
      data: { symbol: 'BTCUSDT', markPrice: '100.3', fundingRate: '0.0002' },
    }));

    const state = adapter.getState('BTCUSDT', 1_300);
    expect(state?.market.markPrice.toString()).toBe('100.3');
    expect(state?.market.indexPrice.toString()).toBe('100.2');
    expect(state?.fundingRate.rate.toString()).toBe('0.0002');
    expect(state?.fundingRate.nextFundingAt?.getTime()).toBe(3_000);
  });

  it('ignores subscription and heartbeat acknowledgements', () => {
    const onState = vi.fn();
    const adapter = new BybitSpotAdapter({ symbols: ['BTCUSDT'], onState });
    expect(() => adapter.handleMessage('{"success":true,"op":"ping"}')).not.toThrow();
    expect(onState).not.toHaveBeenCalled();
  });
});

