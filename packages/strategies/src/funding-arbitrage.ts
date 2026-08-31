import {
  Decimal,
  calculateSlippageBps,
  type Opportunity,
  type OrderBook,
  type PerpMarket,
} from '@arbitrage-scanner/core';
import { quoteBudgetBaseQuantity, vwapForBaseQuantity } from './execution-math.js';

export type FundingVenueId = 'binance-usdm' | 'bybit-linear' | 'hyperliquid';

export interface PerpMarketSnapshot {
  readonly venueId: FundingVenueId;
  readonly market: PerpMarket;
  readonly orderBook: OrderBook;
}

export interface FundingArbitrageConfig {
  readonly maxCapitalUsd: Decimal.Value;
  readonly takerFees?: Partial<Record<FundingVenueId, Decimal.Value>>;
  readonly maxDataAgeMs?: number;
  readonly now?: Date;
}

export interface ArbitrageOpportunity extends Opportunity {
  readonly strategyId: 'S2';
  readonly symbol: string;
  readonly longVenue: FundingVenueId;
  readonly shortVenue: FundingVenueId;
  readonly longHourlyFunding: Decimal;
  readonly shortHourlyFunding: Decimal;
  readonly fundingSpreadHourly: Decimal;
  readonly expected8hFundingRate: Decimal;
  readonly expected24hFundingRate: Decimal;
  readonly annualizedFundingSpread: Decimal;
  readonly expected8hFundingUsd: Decimal;
  readonly expected24hFundingUsd: Decimal;
  readonly priceBasisBps: Decimal;
  readonly entryFeesUsd: Decimal;
  readonly estimatedSlippageUsd: Decimal;
  readonly longSlippageBps: Decimal;
  readonly shortSlippageBps: Decimal;
  readonly executableCapitalUsd: Decimal;
  readonly executableBaseQuantity: Decimal;
}

/** Public base-tier research assumptions. Actual account fees must be injected by callers. */
export const DEFAULT_RESEARCH_TAKER_FEES: Readonly<Record<FundingVenueId, Decimal>> = {
  'binance-usdm': new Decimal('0.0005'),
  'bybit-linear': new Decimal('0.00055'),
  hyperliquid: new Decimal('0.00045'),
};

function normalizedSymbol(market: PerpMarket): string {
  return market.baseAsset.symbol.toUpperCase();
}

function isFresh(snapshot: PerpMarketSnapshot, now: Date, maxAgeMs: number): boolean {
  const newestRequiredTimestamp = Math.min(
    snapshot.market.observedAt.getTime(),
    snapshot.orderBook.observedAt.getTime(),
    snapshot.market.fundingRate?.observedAt.getTime() ?? 0,
  );
  return now.getTime() - newestRequiredTimestamp <= maxAgeMs;
}

function feeFor(venue: FundingVenueId, config: FundingArbitrageConfig): Decimal {
  return new Decimal(config.takerFees?.[venue] ?? DEFAULT_RESEARCH_TAKER_FEES[venue]);
}

function evaluateDirection(
  long: PerpMarketSnapshot,
  short: PerpMarketSnapshot,
  config: FundingArbitrageConfig,
): ArbitrageOpportunity | undefined {
  const longFunding = long.market.fundingRate;
  const shortFunding = short.market.fundingRate;
  const longBestAsk = long.orderBook.asks[0]?.price;
  const shortBestBid = short.orderBook.bids[0]?.price;
  if (longFunding === undefined || shortFunding === undefined
    || longBestAsk === undefined || shortBestBid === undefined) return undefined;

  const fundingSpreadHourly = shortFunding.hourlyRate.minus(longFunding.hourlyRate);
  if (!fundingSpreadHourly.greaterThan(0)) return undefined;

  const maxCapital = new Decimal(config.maxCapitalUsd);
  if (!maxCapital.isFinite() || !maxCapital.greaterThan(0)) {
    throw new RangeError('maxCapitalUsd must be a positive finite decimal');
  }
  const longCapacity = quoteBudgetBaseQuantity(long.orderBook.asks, maxCapital);
  const shortCapacity = quoteBudgetBaseQuantity(short.orderBook.bids, maxCapital);
  const executableBaseQuantity = Decimal.min(longCapacity, shortCapacity);
  const longFill = vwapForBaseQuantity(long.orderBook.asks, executableBaseQuantity);
  const shortFill = vwapForBaseQuantity(short.orderBook.bids, executableBaseQuantity);
  if (longFill === undefined || shortFill === undefined) return undefined;

  const executableCapitalUsd = Decimal.max(longFill.quoteNotional, shortFill.quoteNotional);
  const longSlippageBps = calculateSlippageBps('buy', longFill.vwap, longBestAsk);
  const shortSlippageBps = calculateSlippageBps('sell', shortFill.vwap, shortBestBid);
  const estimatedSlippageUsd = longFill.quoteNotional.mul(longSlippageBps.div(10_000))
    .plus(shortFill.quoteNotional.mul(shortSlippageBps.div(10_000)));
  const entryFeesUsd = longFill.quoteNotional.mul(feeFor(long.venueId, config))
    .plus(shortFill.quoteNotional.mul(feeFor(short.venueId, config)));

  const hourlyFundingUsd = shortFill.quoteNotional.mul(shortFunding.hourlyRate)
    .minus(longFill.quoteNotional.mul(longFunding.hourlyRate));
  const expected8hFundingUsd = hourlyFundingUsd.mul(8);
  const expected24hFundingUsd = hourlyFundingUsd.mul(24);
  const expectedProfitUsd = expected8hFundingUsd.minus(entryFeesUsd).minus(estimatedSlippageUsd);
  const midpoint = longFill.vwap.plus(shortFill.vwap).div(2);
  const priceBasisBps = shortFill.vwap.minus(longFill.vwap).div(midpoint).mul(10_000);
  const observedAt = new Date(Math.min(
    long.orderBook.observedAt.getTime(), short.orderBook.observedAt.getTime(),
  ));

  return {
    id: `S2:${normalizedSymbol(long.market)}:${long.venueId}:long:${short.venueId}:short`,
    strategyId: 'S2',
    symbol: normalizedSymbol(long.market),
    longVenue: long.venueId,
    shortVenue: short.venueId,
    longHourlyFunding: longFunding.hourlyRate,
    shortHourlyFunding: shortFunding.hourlyRate,
    fundingSpreadHourly,
    expected8hFundingRate: fundingSpreadHourly.mul(8),
    expected24hFundingRate: fundingSpreadHourly.mul(24),
    annualizedFundingSpread: fundingSpreadHourly.mul(24 * 365),
    expected8hFundingUsd,
    expected24hFundingUsd,
    priceBasisBps,
    entryFeesUsd,
    estimatedSlippageUsd,
    longSlippageBps,
    shortSlippageBps,
    executableCapitalUsd,
    executableBaseQuantity,
    notionalUsd: executableCapitalUsd,
    expectedProfitUsd,
    expectedEdgeBps: expectedProfitUsd.div(executableCapitalUsd).mul(10_000),
    legs: [
      {
        side: 'buy', marketId: long.market.id,
        price: longFill.vwap, baseQuantity: executableBaseQuantity,
      },
      {
        side: 'sell', marketId: short.market.id,
        price: shortFill.vwap, baseQuantity: executableBaseQuantity,
      },
    ],
    observedAt,
  };
}

export function scanPerpFundingArbitrage(
  snapshots: readonly PerpMarketSnapshot[],
  config: FundingArbitrageConfig,
): readonly ArbitrageOpportunity[] {
  const now = config.now ?? new Date();
  const maxAgeMs = config.maxDataAgeMs ?? 10_000;
  const eligible = snapshots.filter((snapshot) =>
    snapshot.market.marketType === 'perpetual'
    && snapshot.market.fundingRate !== undefined
    && isFresh(snapshot, now, maxAgeMs));
  const bySymbol = new Map<string, PerpMarketSnapshot[]>();
  for (const snapshot of eligible) {
    const symbol = normalizedSymbol(snapshot.market);
    const markets = bySymbol.get(symbol) ?? [];
    markets.push(snapshot);
    bySymbol.set(symbol, markets);
  }
  const opportunities: ArbitrageOpportunity[] = [];

  for (const markets of bySymbol.values()) {
    for (let leftIndex = 0; leftIndex < markets.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < markets.length; rightIndex += 1) {
        const left = markets[leftIndex];
        const right = markets[rightIndex];
        if (left === undefined || right === undefined || left.venueId === right.venueId) continue;
        const leftLong = evaluateDirection(left, right, config);
        const rightLong = evaluateDirection(right, left, config);
        if (leftLong !== undefined) opportunities.push(leftLong);
        if (rightLong !== undefined) opportunities.push(rightLong);
      }
    }
  }

  return opportunities.sort((left, right) => right.expectedEdgeBps.comparedTo(left.expectedEdgeBps));
}
