import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Decimal,
  normalizeFundingRates,
  type OrderBook,
  type PerpMarket,
} from '@arbitrage-scanner/core';
import {
  scanPerpFundingArbitrage,
  type FundingVenueId,
  type PerpMarketSnapshot,
} from './funding-arbitrage.js';

interface FixtureMarket {
  readonly venueId: FundingVenueId;
  readonly venueName: string;
  readonly symbol: string;
  readonly markPrice: string;
  readonly indexPrice: string;
  readonly hourlyFunding: string;
  readonly bids: readonly (readonly [string, string])[];
  readonly asks: readonly (readonly [string, string])[];
}

interface FixtureFile {
  readonly recordedAt: string;
  readonly markets: readonly FixtureMarket[];
}

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/funding-markets.recorded.json', import.meta.url), 'utf8',
)) as FixtureFile;

function snapshots(): PerpMarketSnapshot[] {
  const observedAt = new Date(fixture.recordedAt);
  return fixture.markets.map((item) => {
    const venue = { id: item.venueId, name: item.venueName, kind: item.venueId === 'hyperliquid' ? 'dex' : 'cex' } as const;
    const market: PerpMarket = {
      id: `${item.venueId}:perpetual:${item.symbol}`,
      venue,
      marketType: 'perpetual', symbol: `${item.symbol}-USD`,
      baseAsset: { symbol: item.symbol }, quoteAsset: { symbol: 'USD' },
      markPrice: new Decimal(item.markPrice), indexPrice: new Decimal(item.indexPrice),
      fundingRate: {
        marketId: `${item.venueId}:perpetual:${item.symbol}`,
        ...normalizeFundingRates(item.hourlyFunding, 1),
        nextFundingAt: new Date(observedAt.getTime() + 3_600_000), observedAt,
      },
      observedAt,
    };
    const orderBook: OrderBook = {
      market,
      bids: item.bids.map(([price, quantity]) => ({ price: new Decimal(price), quantity: new Decimal(quantity) })),
      asks: item.asks.map(([price, quantity]) => ({ price: new Decimal(price), quantity: new Decimal(quantity) })),
      observedAt,
    };
    return { venueId: item.venueId, market, orderBook };
  });
}

const config = {
  maxCapitalUsd: '10000',
  now: new Date(fixture.recordedAt),
  maxDataAgeMs: 1_000,
  takerFees: {
    'binance-usdm': '0.0005', 'bybit-linear': '0.00055', hyperliquid: '0.00045',
  },
} as const;

describe('S2 perp-to-perp funding arbitrage', () => {
  it('compares every venue pair for each common symbol', () => {
    const opportunities = scanPerpFundingArbitrage(snapshots(), config);

    expect(opportunities).toHaveLength(3);
    expect(new Set(opportunities.map((item) => `${item.longVenue}/${item.shortVenue}`))).toEqual(new Set([
      'binance-usdm/bybit-linear',
      'hyperliquid/binance-usdm',
      'hyperliquid/bybit-linear',
    ]));
    expect(opportunities.every((item) => item.symbol === 'BTC')).toBe(true);
  });

  it('normalizes funding horizons and annualized spread', () => {
    const opportunity = scanPerpFundingArbitrage(snapshots(), config)
      .find((item) => item.longVenue === 'hyperliquid' && item.shortVenue === 'bybit-linear');

    expect(opportunity?.longHourlyFunding.toString()).toBe('-0.00002');
    expect(opportunity?.shortHourlyFunding.toString()).toBe('0.00003');
    expect(opportunity?.fundingSpreadHourly.toString()).toBe('0.00005');
    expect(opportunity?.expected8hFundingRate.toString()).toBe('0.0004');
    expect(opportunity?.expected24hFundingRate.toString()).toBe('0.0012');
    expect(opportunity?.annualizedFundingSpread.toString()).toBe('0.438');
  });

  it('uses equal base quantity on both legs and respects the capital ceiling', () => {
    const opportunity = scanPerpFundingArbitrage(snapshots(), config)[0];
    expect(opportunity).toBeDefined();
    expect(opportunity?.legs[0]?.baseQuantity.equals(opportunity.legs[1]?.baseQuantity ?? 0)).toBe(true);
    expect(opportunity?.executableCapitalUsd.lessThanOrEqualTo(10_000)).toBe(true);
    expect(opportunity?.executableBaseQuantity.greaterThan(0)).toBe(true);
  });

  it('calculates depth-aware basis, fees, slippage, and net expected profit', () => {
    const opportunity = scanPerpFundingArbitrage(snapshots(), config)
      .find((item) => item.longVenue === 'hyperliquid' && item.shortVenue === 'bybit-linear');

    expect(opportunity?.priceBasisBps.isFinite()).toBe(true);
    expect(opportunity?.entryFeesUsd.greaterThan(0)).toBe(true);
    expect(opportunity?.longSlippageBps.greaterThan(0)).toBe(true);
    expect(opportunity?.shortSlippageBps.greaterThan(0)).toBe(true);
    expect(opportunity?.estimatedSlippageUsd.greaterThan(0)).toBe(true);
    expect(opportunity?.expectedProfitUsd.equals(
      opportunity.expected8hFundingUsd.minus(opportunity.entryFeesUsd).minus(opportunity.estimatedSlippageUsd),
    )).toBe(true);
  });

  it('excludes stale snapshots and markets without a cross-venue match', () => {
    expect(scanPerpFundingArbitrage(snapshots(), {
      ...config, now: new Date(new Date(fixture.recordedAt).getTime() + 2_000),
    })).toEqual([]);
    expect(scanPerpFundingArbitrage(snapshots().filter((item) => item.market.baseAsset.symbol === 'ETH'), config))
      .toEqual([]);
  });

  it('does not emit the direction with a negative funding spread', () => {
    const opportunities = scanPerpFundingArbitrage(snapshots().slice(0, 2), config);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ longVenue: 'binance-usdm', shortVenue: 'bybit-linear' });
  });
});
