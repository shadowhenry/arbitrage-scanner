import { describe, expect, it } from 'vitest';
import {
  nextHourlyFundingAt,
  normalizeHistoricalFunding,
  normalizeHyperliquidFunding,
  normalizeHyperliquidPerp,
  normalizeHyperliquidSpot,
} from './normalize.js';

describe('Hyperliquid normalization', () => {
  it('normalizes hourly funding and simple annualization', () => {
    const observedAt = new Date('2026-01-01T00:30:00.000Z');
    const funding = normalizeHyperliquidFunding('hyperliquid:perpetual:BTC', '0.0001', observedAt);
    expect(funding.hourlyRate.toString()).toBe('0.0001');
    expect(funding.annualizedRate.toString()).toBe('0.876');
    expect(funding.nextFundingAt.toISOString()).toBe('2026-01-01T01:00:00.000Z');
  });

  it('normalizes historical funding to the following hourly settlement', () => {
    const funding = normalizeHistoricalFunding({
      coin: 'ETH', fundingRate: '-0.0002', premium: '0', time: 1_000,
    });
    expect(funding.marketId).toBe('hyperliquid:perpetual:ETH');
    expect(funding.hourlyRate.toString()).toBe('-0.0002');
    expect(funding.nextFundingAt.getTime()).toBe(3_601_000);
  });

  it('normalizes perpetual mark and oracle prices', () => {
    const market = normalizeHyperliquidPerp(
      'SOL', { markPx: '150.1', oraclePx: '150.2', funding: '0.00001' }, new Date(1_000), '150', '150.3',
    );
    expect(market.markPrice.toString()).toBe('150.1');
    expect(market.indexPrice.toString()).toBe('150.2');
    expect(market.bestBid?.toString()).toBe('150');
    expect(market.fundingRate?.hourlyRate.toString()).toBe('0.00001');
  });

  it('normalizes available spot metadata and prices', () => {
    const quote = normalizeHyperliquidSpot(
      { name: '@7', tokens: [5, 0], index: 7 },
      { name: 'HYPE', szDecimals: 2, weiDecimals: 8, index: 5, tokenId: 'base' },
      { name: 'USDC', szDecimals: 6, weiDecimals: 6, index: 0, tokenId: 'quote' },
      { markPx: '40.1' }, new Date(1_000), '40', '40.2',
    );
    expect(quote.id).toBe('hyperliquid:spot:@7');
    expect(quote.symbol).toBe('HYPE/USDC');
    expect(quote.lastPrice?.toString()).toBe('40.1');
  });

  it('rounds next funding to the next UTC hour', () => {
    expect(nextHourlyFundingAt(0).getTime()).toBe(3_600_000);
    expect(nextHourlyFundingAt(3_600_000).getTime()).toBe(7_200_000);
  });
});

