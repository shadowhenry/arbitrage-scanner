import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Decimal,
  normalizeFundingRates,
  type MarketQuote,
  type OrderBook,
  type PerpMarket,
} from '@arbitrage-scanner/core';
import {
  HOLDING_HORIZON_HOURS,
  scanSpotPerpBasisArbitrage,
  type SpotMarketSnapshot,
  type SpotVenueId,
} from './basis-arbitrage.js';
import type { FundingVenueId, PerpMarketSnapshot } from './funding-arbitrage.js';

interface RecordedMarket {
  readonly venueId: string;
  readonly venueName: string;
  readonly symbol: string;
  readonly markPrice?: string;
  readonly indexPrice?: string;
  readonly hourlyFunding?: string;
  readonly lastPrice?: string;
  readonly bids: readonly (readonly [string, string])[];
  readonly asks: readonly (readonly [string, string])[];
}

interface RecordedFile {
  readonly recordedAt: string;
  readonly markets: readonly RecordedMarket[];
}

const readFixture = (name: string): RecordedFile => JSON.parse(readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url), 'utf8',
)) as RecordedFile;
const spotFixture = readFixture('spot-markets.recorded.json');
const perpFixture = readFixture('funding-markets.recorded.json');
const observedAt = new Date(spotFixture.recordedAt);

function levels(items: readonly (readonly [string, string])[]) {
  return items.map(([price, quantity]) => ({ price: new Decimal(price), quantity: new Decimal(quantity) }));
}

function spotSnapshots(): SpotMarketSnapshot[] {
  return spotFixture.markets.map((item) => {
    const venueId = item.venueId as SpotVenueId;
    const market: MarketQuote = {
      id: `${venueId}:spot:${item.symbol}`,
      venue: { id: venueId, name: item.venueName, kind: 'cex' },
      marketType: 'spot', symbol: `${item.symbol}-USD`,
      baseAsset: { symbol: item.symbol }, quoteAsset: { symbol: 'USD' },
      lastPrice: new Decimal(item.lastPrice ?? '0'), observedAt,
    };
    return {
      venueId,
      market,
      orderBook: { market, bids: levels(item.bids), asks: levels(item.asks), observedAt },
    };
  });
}

function perpSnapshots(): PerpMarketSnapshot[] {
  return perpFixture.markets.map((item) => {
    const venueId = item.venueId as FundingVenueId;
    const market: PerpMarket = {
      id: `${venueId}:perpetual:${item.symbol}`,
      venue: { id: venueId, name: item.venueName, kind: venueId === 'hyperliquid' ? 'dex' : 'cex' },
      marketType: 'perpetual', symbol: `${item.symbol}-USD`,
      baseAsset: { symbol: item.symbol }, quoteAsset: { symbol: 'USD' },
      markPrice: new Decimal(item.markPrice ?? '0'), indexPrice: new Decimal(item.indexPrice ?? '0'),
      fundingRate: {
        marketId: `${venueId}:perpetual:${item.symbol}`,
        ...normalizeFundingRates(item.hourlyFunding ?? '0', 1),
        nextFundingAt: new Date(observedAt.getTime() + 3_600_000), observedAt,
      },
      observedAt,
    };
    const orderBook: OrderBook = {
      market, bids: levels(item.bids), asks: levels(item.asks), observedAt,
    };
    return { venueId, market, orderBook };
  });
}

const config = {
  maxCapitalUsd: '10000', now: observedAt, maxDataAgeMs: 1_000,
  spotTakerFees: { binance: '0.001', bybit: '0.001' },
  perpTakerFees: {
    'binance-usdm': '0.0005', 'bybit-linear': '0.00055', hyperliquid: '0.00045',
  },
} as const;

describe('S1 spot/perp basis arbitrage', () => {
  it('generates all six requested BTC spot-to-perp combinations', () => {
    const opportunities = scanSpotPerpBasisArbitrage(spotSnapshots(), perpSnapshots(), config);
    const combinations = opportunities.map((item) => `${item.spotVenue}/${item.perpVenue}`);

    expect(opportunities).toHaveLength(6);
    expect(new Set(combinations)).toEqual(new Set([
      'binance/binance-usdm', 'binance/bybit-linear', 'binance/hyperliquid',
      'bybit/binance-usdm', 'bybit/bybit-linear', 'bybit/hyperliquid',
    ]));
  });

  it('provides 8h, 24h, 3d, and 7d projections', () => {
    const opportunity = scanSpotPerpBasisArbitrage(spotSnapshots(), perpSnapshots(), config)[0];
    expect(Object.keys(opportunity?.projections ?? {})).toEqual(['8h', '24h', '3d', '7d']);
    expect(opportunity?.projections['8h'].hours).toBe(HOLDING_HORIZON_HOURS['8h']);
    expect(opportunity?.projections['24h'].hours).toBe(24);
    expect(opportunity?.projections['3d'].hours).toBe(72);
    expect(opportunity?.projections['7d'].hours).toBe(168);
  });

  it('keeps equal base quantity on spot and perp legs within the capital ceiling', () => {
    const opportunity = scanSpotPerpBasisArbitrage(spotSnapshots(), perpSnapshots(), config)[0];
    expect(opportunity?.legs[0]?.baseQuantity.equals(opportunity.legs[1]?.baseQuantity ?? 0)).toBe(true);
    expect(opportunity?.executableCapitalUsd.lessThanOrEqualTo(10_000)).toBe(true);
  });

  it('separates top-of-book gross basis from depth slippage without double counting', () => {
    const opportunity = scanSpotPerpBasisArbitrage(spotSnapshots(), perpSnapshots(), config)
      .find((item) => item.spotVenue === 'binance' && item.perpVenue === 'bybit-linear');
    expect(opportunity).toBeDefined();
    const spotLeg = opportunity?.legs[0];
    const perpLeg = opportunity?.legs[1];
    const executableBasis = (perpLeg?.price ?? new Decimal(0)).mul(perpLeg?.baseQuantity ?? 0)
      .minus((spotLeg?.price ?? new Decimal(0)).mul(spotLeg?.baseQuantity ?? 0));
    expect(opportunity?.grossBasisUsd.minus(opportunity.estimatedSlippageUsd).equals(executableBasis)).toBe(true);
    expect(opportunity?.spotSlippageBps.greaterThan(0)).toBe(true);
    expect(opportunity?.perpSlippageBps.greaterThan(0)).toBe(true);
  });

  it('deducts entry and estimated exit fees from each horizon net return', () => {
    const opportunity = scanSpotPerpBasisArbitrage(spotSnapshots(), perpSnapshots(), config)
      .find((item) => item.spotVenue === 'binance' && item.perpVenue === 'bybit-linear');
    expect(opportunity?.entryFeeUsd.greaterThan(0)).toBe(true);
    expect(opportunity?.exitFeeEstimateUsd.equals(opportunity.entryFeeUsd)).toBe(true);
    const executableBasis = opportunity?.grossBasisUsd.minus(opportunity.estimatedSlippageUsd) ?? new Decimal(0);
    const expectedNet = executableBasis
      .plus(opportunity?.projections['8h'].estimatedFundingUsd ?? 0)
      .minus(opportunity?.entryFeeUsd ?? 0)
      .minus(opportunity?.exitFeeEstimateUsd ?? 0);
    expect(opportunity?.projections['8h'].netExpectedProfitUsd.equals(expectedNet)).toBe(true);
  });

  it('projects positive and negative funding over time', () => {
    const opportunities = scanSpotPerpBasisArbitrage(spotSnapshots(), perpSnapshots(), config);
    const positive = opportunities.find((item) => item.perpVenue === 'bybit-linear');
    const negative = opportunities.find((item) => item.perpVenue === 'hyperliquid');
    expect(positive?.projections['7d'].estimatedFundingUsd.greaterThan(positive.projections['8h'].estimatedFundingUsd)).toBe(true);
    expect(negative?.projections['7d'].estimatedFundingUsd.lessThan(negative.projections['8h'].estimatedFundingUsd)).toBe(true);
  });

  it('excludes stale data and symbols without a common market', () => {
    expect(scanSpotPerpBasisArbitrage(spotSnapshots(), perpSnapshots(), {
      ...config, now: new Date(observedAt.getTime() + 2_000),
    })).toEqual([]);
    expect(scanSpotPerpBasisArbitrage(
      spotSnapshots().filter((item) => item.market.baseAsset.symbol === 'SOL'), perpSnapshots(), config,
    )).toEqual([]);
  });
});

