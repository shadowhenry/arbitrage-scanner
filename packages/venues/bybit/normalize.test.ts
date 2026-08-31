import { describe, expect, it } from 'vitest';
import {
  normalizeBybitFundingRate,
  normalizeBybitLinearTicker,
  normalizeBybitSpotTicker,
  splitBybitUsdtSymbol,
} from './normalize.js';
import type { BybitTickerData } from './types.js';

const spot: BybitTickerData = {
  symbol: 'BTCUSDT', lastPrice: '100.05', bid1Price: '100.01', ask1Price: '100.09',
};
const linear: BybitTickerData = {
  ...spot, markPrice: '100.04', indexPrice: '100.03', fundingRate: '-0.0001',
  fundingIntervalHour: '8', nextFundingTime: '2000',
};
const observedAt = new Date(1_000);

describe('Bybit normalization', () => {
  it('normalizes Spot ticker decimals', () => {
    const quote = normalizeBybitSpotTicker(spot, observedAt);
    expect(quote.id).toBe('bybit:spot:BTCUSDT');
    expect(quote.bestBid?.toString()).toBe('100.01');
    expect(quote.bestAsk?.toString()).toBe('100.09');
    expect(quote.lastPrice?.toString()).toBe('100.05');
  });

  it('normalizes Linear mark, index, funding, interval and timestamp', () => {
    const market = normalizeBybitLinearTicker(linear, observedAt);
    const funding = normalizeBybitFundingRate(linear, observedAt);
    expect(market.markPrice.toString()).toBe('100.04');
    expect(market.indexPrice.toString()).toBe('100.03');
    expect(funding.rate.toString()).toBe('-0.0001');
    expect(funding.hourlyRate.toString()).toBe('-0.0000125');
    expect(funding.annualizedRate.toString()).toBe('-0.1095');
    expect(funding.intervalHours.toString()).toBe('8');
    expect(funding.nextFundingAt?.getTime()).toBe(2_000);
  });

  it('rejects incomplete ticker state and unsupported symbols', () => {
    expect(() => normalizeBybitSpotTicker({ symbol: 'BTCUSDT' }, observedAt)).toThrow('bid1Price');
    expect(() => splitBybitUsdtSymbol('BTCUSD')).toThrow('Unsupported Bybit symbol');
  });
});
