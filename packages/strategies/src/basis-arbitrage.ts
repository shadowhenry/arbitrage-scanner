import {
  Decimal,
  calculateSlippageBps,
  type MarketQuote,
  type Opportunity,
  type OrderBook,
} from '@arbitrage-scanner/core';
import {
  DEFAULT_RESEARCH_TAKER_FEES,
  type FundingVenueId,
  type PerpMarketSnapshot,
} from './funding-arbitrage.js';
import { quoteBudgetBaseQuantity, vwapForBaseQuantity } from './execution-math.js';

export type SpotVenueId = 'binance' | 'bybit';
export type HoldingHorizon = '8h' | '24h' | '3d' | '7d';

export const HOLDING_HORIZON_HOURS: Readonly<Record<HoldingHorizon, number>> = {
  '8h': 8,
  '24h': 24,
  '3d': 72,
  '7d': 168,
};

export const DEFAULT_RESEARCH_SPOT_TAKER_FEES: Readonly<Record<SpotVenueId, Decimal>> = {
  binance: new Decimal('0.001'),
  bybit: new Decimal('0.001'),
};

export interface SpotMarketSnapshot {
  readonly venueId: SpotVenueId;
  readonly market: MarketQuote;
  readonly orderBook: OrderBook;
}

export interface BasisArbitrageConfig {
  readonly maxCapitalUsd: Decimal.Value;
  readonly spotTakerFees?: Partial<Record<SpotVenueId, Decimal.Value>>;
  readonly perpTakerFees?: Partial<Record<FundingVenueId, Decimal.Value>>;
  readonly maxDataAgeMs?: number;
  readonly now?: Date;
}

export interface BasisHorizonProjection {
  readonly horizon: HoldingHorizon;
  readonly hours: number;
  /** Assumes the current hourly funding rate remains constant. */
  readonly estimatedFundingUsd: Decimal;
  readonly netExpectedProfitUsd: Decimal;
  readonly netExpectedReturn: Decimal;
  readonly netExpectedReturnBps: Decimal;
}

export interface SpotPerpBasisOpportunity extends Opportunity {
  readonly strategyId: 'S1';
  readonly symbol: string;
  readonly spotVenue: SpotVenueId;
  readonly perpVenue: FundingVenueId;
  readonly grossBasisUsd: Decimal;
  readonly grossBasisRate: Decimal;
  readonly grossBasisBps: Decimal;
  readonly entryFeeUsd: Decimal;
  readonly exitFeeEstimateUsd: Decimal;
  readonly estimatedSlippageUsd: Decimal;
  readonly spotSlippageBps: Decimal;
  readonly perpSlippageBps: Decimal;
  readonly hourlyFundingRate: Decimal;
  readonly executableCapitalUsd: Decimal;
  readonly executableBaseQuantity: Decimal;
  readonly projections: Readonly<Record<HoldingHorizon, BasisHorizonProjection>>;
}

function isFresh(observedTimes: readonly Date[], now: Date, maxAgeMs: number): boolean {
  return observedTimes.every((time) => now.getTime() - time.getTime() <= maxAgeMs);
}

function spotFee(venue: SpotVenueId, config: BasisArbitrageConfig): Decimal {
  return new Decimal(config.spotTakerFees?.[venue] ?? DEFAULT_RESEARCH_SPOT_TAKER_FEES[venue]);
}

function perpFee(venue: FundingVenueId, config: BasisArbitrageConfig): Decimal {
  return new Decimal(config.perpTakerFees?.[venue] ?? DEFAULT_RESEARCH_TAKER_FEES[venue]);
}

function buildProjection(
  horizon: HoldingHorizon,
  hourlyFundingUsd: Decimal,
  executableEntryBasisUsd: Decimal,
  totalFeesUsd: Decimal,
  capital: Decimal,
): BasisHorizonProjection {
  const hours = HOLDING_HORIZON_HOURS[horizon];
  const estimatedFundingUsd = hourlyFundingUsd.mul(hours);
  const netExpectedProfitUsd = executableEntryBasisUsd.plus(estimatedFundingUsd).minus(totalFeesUsd);
  const netExpectedReturn = netExpectedProfitUsd.div(capital);
  return {
    horizon,
    hours,
    estimatedFundingUsd,
    netExpectedProfitUsd,
    netExpectedReturn,
    netExpectedReturnBps: netExpectedReturn.mul(10_000),
  };
}

function evaluateCombination(
  spot: SpotMarketSnapshot,
  perp: PerpMarketSnapshot,
  config: BasisArbitrageConfig,
): SpotPerpBasisOpportunity | undefined {
  const funding = perp.market.fundingRate;
  const spotBestAsk = spot.orderBook.asks[0]?.price;
  const perpBestBid = perp.orderBook.bids[0]?.price;
  if (funding === undefined || spotBestAsk === undefined || perpBestBid === undefined) return undefined;

  const maxCapital = new Decimal(config.maxCapitalUsd);
  if (!maxCapital.isFinite() || !maxCapital.greaterThan(0)) {
    throw new RangeError('maxCapitalUsd must be a positive finite decimal');
  }

  const spotCapacity = quoteBudgetBaseQuantity(spot.orderBook.asks, maxCapital);
  const perpCapacity = quoteBudgetBaseQuantity(perp.orderBook.bids, maxCapital);
  const executableBaseQuantity = Decimal.min(spotCapacity, perpCapacity);
  const spotFill = vwapForBaseQuantity(spot.orderBook.asks, executableBaseQuantity);
  const perpFill = vwapForBaseQuantity(perp.orderBook.bids, executableBaseQuantity);
  if (spotFill === undefined || perpFill === undefined) return undefined;

  const executableCapitalUsd = Decimal.max(spotFill.quoteNotional, perpFill.quoteNotional);
  const topSpotCost = spotBestAsk.mul(executableBaseQuantity);
  const topPerpProceeds = perpBestBid.mul(executableBaseQuantity);
  const grossBasisUsd = topPerpProceeds.minus(topSpotCost);
  const grossBasisRate = grossBasisUsd.div(topSpotCost);
  const executableEntryBasisUsd = perpFill.quoteNotional.minus(spotFill.quoteNotional);
  const estimatedSlippageUsd = grossBasisUsd.minus(executableEntryBasisUsd);
  const spotSlippageBps = calculateSlippageBps('buy', spotFill.vwap, spotBestAsk);
  const perpSlippageBps = calculateSlippageBps('sell', perpFill.vwap, perpBestBid);
  const entryFeeUsd = spotFill.quoteNotional.mul(spotFee(spot.venueId, config))
    .plus(perpFill.quoteNotional.mul(perpFee(perp.venueId, config)));
  const exitFeeEstimateUsd = entryFeeUsd;
  const totalFeesUsd = entryFeeUsd.plus(exitFeeEstimateUsd);
  const hourlyFundingUsd = perpFill.quoteNotional.mul(funding.hourlyRate);
  const projections = Object.fromEntries(
    (Object.keys(HOLDING_HORIZON_HOURS) as HoldingHorizon[]).map((horizon) => [
      horizon,
      buildProjection(
        horizon, hourlyFundingUsd, executableEntryBasisUsd, totalFeesUsd, executableCapitalUsd,
      ),
    ]),
  ) as unknown as Readonly<Record<HoldingHorizon, BasisHorizonProjection>>;
  const observedAt = new Date(Math.min(
    spot.orderBook.observedAt.getTime(), perp.orderBook.observedAt.getTime(),
  ));
  const projection8h = projections['8h'];

  return {
    id: `S1:${spot.market.baseAsset.symbol.toUpperCase()}:${spot.venueId}:spot:${perp.venueId}:perp`,
    strategyId: 'S1',
    symbol: spot.market.baseAsset.symbol.toUpperCase(),
    spotVenue: spot.venueId,
    perpVenue: perp.venueId,
    grossBasisUsd,
    grossBasisRate,
    grossBasisBps: grossBasisRate.mul(10_000),
    entryFeeUsd,
    exitFeeEstimateUsd,
    estimatedSlippageUsd,
    spotSlippageBps,
    perpSlippageBps,
    hourlyFundingRate: funding.hourlyRate,
    executableCapitalUsd,
    executableBaseQuantity,
    projections,
    notionalUsd: executableCapitalUsd,
    expectedProfitUsd: projection8h.netExpectedProfitUsd,
    expectedEdgeBps: projection8h.netExpectedReturnBps,
    legs: [
      {
        side: 'buy', marketId: spot.market.id,
        price: spotFill.vwap, baseQuantity: executableBaseQuantity,
      },
      {
        side: 'sell', marketId: perp.market.id,
        price: perpFill.vwap, baseQuantity: executableBaseQuantity,
      },
    ],
    observedAt,
  };
}

export function scanSpotPerpBasisArbitrage(
  spots: readonly SpotMarketSnapshot[],
  perps: readonly PerpMarketSnapshot[],
  config: BasisArbitrageConfig,
): readonly SpotPerpBasisOpportunity[] {
  const now = config.now ?? new Date();
  const maxAgeMs = config.maxDataAgeMs ?? 10_000;
  const opportunities: SpotPerpBasisOpportunity[] = [];

  for (const spot of spots) {
    if (spot.market.marketType !== 'spot' || !isFresh(
      [spot.market.observedAt, spot.orderBook.observedAt], now, maxAgeMs,
    )) continue;
    for (const perp of perps) {
      if (spot.market.baseAsset.symbol.toUpperCase() !== perp.market.baseAsset.symbol.toUpperCase()) continue;
      const fundingObservedAt = perp.market.fundingRate?.observedAt;
      if (fundingObservedAt === undefined || !isFresh(
        [perp.market.observedAt, perp.orderBook.observedAt, fundingObservedAt], now, maxAgeMs,
      )) continue;
      const opportunity = evaluateCombination(spot, perp, config);
      if (opportunity !== undefined) opportunities.push(opportunity);
    }
  }

  return opportunities.sort((left, right) => right.expectedEdgeBps.comparedTo(left.expectedEdgeBps));
}
