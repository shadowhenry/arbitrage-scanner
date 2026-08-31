import { Decimal } from 'decimal.js';

export { Decimal };

export const EXECUTABLE_NOTIONALS_USD = [
  100,
  500,
  1_000,
  2_500,
  5_000,
  10_000,
  25_000,
] as const;

export type ExecutableNotionalUsd = (typeof EXECUTABLE_NOTIONALS_USD)[number];
export type MarketType = 'spot' | 'perpetual' | 'prediction';
export type VenueKind = 'cex' | 'dex' | 'prediction';
export type OrderSide = 'buy' | 'sell';

export interface Venue {
  readonly id: string;
  readonly name: string;
  readonly kind: VenueKind;
}

export interface Asset {
  readonly symbol: string;
  readonly name?: string;
  readonly decimals?: number;
  readonly network?: string;
  readonly contractAddress?: string;
}

export interface MarketQuote {
  readonly id: string;
  readonly venue: Venue;
  readonly marketType: MarketType;
  readonly symbol: string;
  readonly baseAsset: Asset;
  readonly quoteAsset: Asset;
  readonly bestBid?: Decimal;
  readonly bestAsk?: Decimal;
  readonly lastPrice?: Decimal;
  readonly observedAt: Date;
}

export interface OrderBookLevel {
  /** Price in quote-asset units per base-asset unit. */
  readonly price: Decimal;
  /** Available base-asset quantity at this price. */
  readonly quantity: Decimal;
}

export interface OrderBook {
  readonly market: MarketQuote;
  /** Highest price first. */
  readonly bids: readonly OrderBookLevel[];
  /** Lowest price first. */
  readonly asks: readonly OrderBookLevel[];
  readonly observedAt: Date;
  readonly sequence?: string;
}

export interface FundingRate {
  readonly marketId: string;
  /** Funding rate normalized to one hour; 0.0001 means 1 bp per hour. */
  readonly hourlyRate: Decimal;
  /** Simple annualization: hourlyRate × 24 × 365. */
  readonly annualizedRate: Decimal;
  /** Original venue interval rate, retained for auditability. */
  readonly rate: Decimal;
  readonly intervalHours: Decimal;
  readonly nextFundingAt: Date;
  readonly observedAt: Date;
}

export function normalizeFundingRates(
  intervalRate: Decimal.Value,
  intervalHours: Decimal.Value,
): Pick<FundingRate, 'rate' | 'intervalHours' | 'hourlyRate' | 'annualizedRate'> {
  const rate = new Decimal(intervalRate);
  const hours = new Decimal(intervalHours);
  if (!rate.isFinite() || !hours.isFinite() || !hours.greaterThan(0)) {
    throw new RangeError('Funding rate must be finite and intervalHours must be positive');
  }
  const hourlyRate = rate.div(hours);
  return { rate, intervalHours: hours, hourlyRate, annualizedRate: hourlyRate.mul(24 * 365) };
}

export interface PerpMarket extends Omit<MarketQuote, 'marketType'> {
  readonly marketType: 'perpetual';
  readonly indexPrice: Decimal;
  readonly markPrice: Decimal;
  readonly fundingRate?: FundingRate;
}

export interface PredictionOutcome {
  readonly id: string;
  readonly name: string;
  readonly asset: Asset;
}

export interface PredictionMarket extends Omit<MarketQuote, 'marketType'> {
  readonly marketType: 'prediction';
  readonly question: string;
  readonly outcomes: readonly PredictionOutcome[];
  readonly resolvesAt?: Date;
}

export interface PredictionFeeInformation {
  readonly outcomeId: string;
  readonly enabled: boolean;
  /** Fee coefficient used in shares × rate × price × (1 - price). */
  readonly takerFeeRate: Decimal;
  readonly exponent: Decimal;
  readonly baseFee: Decimal;
  readonly observedAt: Date;
}

export interface BinaryPredictionMarketSnapshot {
  readonly market: PredictionMarket;
  readonly yesOrderBook: OrderBook;
  readonly noOrderBook: OrderBook;
  readonly yesFee: PredictionFeeInformation;
  readonly noFee: PredictionFeeInformation;
}

export interface VwapResult {
  readonly side: OrderSide;
  readonly requestedQuote: Decimal;
  readonly filledQuote: Decimal;
  readonly baseQuantity: Decimal;
  readonly vwap: Decimal | null;
  readonly fullyExecutable: boolean;
  readonly levelsConsumed: number;
}

export interface ExecutablePricePoint extends VwapResult {
  readonly notionalUsd: ExecutableNotionalUsd;
  readonly slippage: Decimal | null;
  readonly slippageBps: Decimal | null;
}

export interface OrderBookExecutablePriceCurve {
  readonly kind: 'orderbook';
  readonly marketId: string;
  readonly observedAt: Date;
  readonly buy: readonly ExecutablePricePoint[];
  readonly sell: readonly ExecutablePricePoint[];
}

export interface ExecutableRouteStep {
  readonly ammKey: string;
  readonly dexLabel: string;
  readonly inputMint: string;
  readonly outputMint: string;
  /** Atomic token units, retained exactly as returned by the router. */
  readonly inputAmountAtomic?: string;
  readonly outputAmountAtomic?: string;
  readonly feeAmountAtomic?: string;
  readonly feeMint?: string;
  readonly percent: Decimal;
}

export interface ExecutableLiquiditySource {
  readonly poolId: string;
  readonly poolType?: string;
  readonly liquidityUsd: Decimal;
}

export interface ExecutableRoutePoint {
  readonly notionalUsd: ExecutableNotionalUsd;
  /** Decimal token amount after applying the configured mint decimals. */
  readonly inputAmount: Decimal;
  readonly outputAmount: Decimal;
  /** Input-token units paid per output-token unit. */
  readonly effectivePrice: Decimal;
  /** Decimal fraction; 0.001 means 10 bps. */
  readonly priceImpact: Decimal;
  readonly route: readonly ExecutableRouteStep[];
  readonly dexLabels: readonly string[];
  /** Time at which the quote response was received by the adapter. */
  readonly quoteTimestamp: Date;
  readonly pools?: readonly ExecutableLiquiditySource[];
  readonly liquidityUsd?: Decimal;
  readonly quoteAgeMs?: number;
  readonly contextSlot?: string;
}

export interface RoutingExecutablePriceCurve {
  readonly kind: 'routing';
  readonly marketId: string;
  readonly observedAt: Date;
  readonly inputAsset: Asset;
  readonly outputAsset: Asset;
  readonly quotes: readonly ExecutableRoutePoint[];
}

export type ExecutablePriceCurve =
  | OrderBookExecutablePriceCurve
  | RoutingExecutablePriceCurve;

export interface OpportunityLeg {
  readonly side: OrderSide;
  readonly marketId: string;
  readonly price: Decimal;
  readonly baseQuantity: Decimal;
}

export interface Opportunity {
  readonly id: string;
  readonly strategyId: string;
  readonly notionalUsd: Decimal;
  readonly expectedProfitUsd: Decimal;
  readonly expectedEdgeBps: Decimal;
  readonly legs: readonly OpportunityLeg[];
  readonly observedAt: Date;
}

export interface HealthStatus {
  readonly service: string;
  readonly status: 'ok' | 'degraded' | 'unavailable';
  readonly timestamp: string;
}

export function healthy(service: string, now = new Date()): HealthStatus {
  return { service, status: 'ok', timestamp: now.toISOString() };
}

function positiveDecimal(value: Decimal.Value, name: string): Decimal {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || !decimal.greaterThan(0)) {
    throw new RangeError(`${name} must be a positive finite decimal`);
  }
  return decimal;
}

function validateLevel(level: OrderBookLevel, index: number): void {
  positiveDecimal(level.price, `levels[${index}].price`);
  positiveDecimal(level.quantity, `levels[${index}].quantity`);
}

/**
 * Calculates the average ask price when spending an exact quote-asset amount.
 * Returns no VWAP when the requested amount cannot be filled in full.
 */
export function calculateBuyVwap(
  asks: readonly OrderBookLevel[],
  quoteNotional: Decimal.Value,
): VwapResult {
  const requestedQuote = positiveDecimal(quoteNotional, 'quoteNotional');
  let remainingQuote = requestedQuote;
  let filledQuote = new Decimal(0);
  let baseQuantity = new Decimal(0);
  let levelsConsumed = 0;

  for (const [index, level] of asks.entries()) {
    validateLevel(level, index);
    if (remainingQuote.isZero()) break;

    const availableQuote = level.price.mul(level.quantity);
    const quoteAtLevel = Decimal.min(remainingQuote, availableQuote);
    filledQuote = filledQuote.plus(quoteAtLevel);
    baseQuantity = baseQuantity.plus(quoteAtLevel.div(level.price));
    remainingQuote = remainingQuote.minus(quoteAtLevel);
    levelsConsumed += 1;
  }

  const fullyExecutable = remainingQuote.isZero();
  return {
    side: 'buy',
    requestedQuote,
    filledQuote,
    baseQuantity,
    vwap: fullyExecutable ? filledQuote.div(baseQuantity) : null,
    fullyExecutable,
    levelsConsumed,
  };
}

/**
 * Calculates the average bid price for an exact quote-asset proceeds target.
 * Returns no VWAP when available bids cannot produce the requested proceeds.
 */
export function calculateSellVwap(
  bids: readonly OrderBookLevel[],
  quoteNotional: Decimal.Value,
): VwapResult {
  const requestedQuote = positiveDecimal(quoteNotional, 'quoteNotional');
  let remainingQuote = requestedQuote;
  let filledQuote = new Decimal(0);
  let baseQuantity = new Decimal(0);
  let levelsConsumed = 0;

  for (const [index, level] of bids.entries()) {
    validateLevel(level, index);
    if (remainingQuote.isZero()) break;

    const availableQuote = level.price.mul(level.quantity);
    const quoteAtLevel = Decimal.min(remainingQuote, availableQuote);
    filledQuote = filledQuote.plus(quoteAtLevel);
    baseQuantity = baseQuantity.plus(quoteAtLevel.div(level.price));
    remainingQuote = remainingQuote.minus(quoteAtLevel);
    levelsConsumed += 1;
  }

  const fullyExecutable = remainingQuote.isZero();
  return {
    side: 'sell',
    requestedQuote,
    filledQuote,
    baseQuantity,
    vwap: fullyExecutable ? filledQuote.div(baseQuantity) : null,
    fullyExecutable,
    levelsConsumed,
  };
}

/** Returns adverse price movement as a decimal fraction of the reference price. */
export function calculateSlippage(
  side: OrderSide,
  executionPrice: Decimal.Value,
  referencePrice: Decimal.Value,
): Decimal {
  const execution = positiveDecimal(executionPrice, 'executionPrice');
  const reference = positiveDecimal(referencePrice, 'referencePrice');
  return side === 'buy'
    ? execution.minus(reference).div(reference)
    : reference.minus(execution).div(reference);
}

export function calculateSlippageBps(
  side: OrderSide,
  executionPrice: Decimal.Value,
  referencePrice: Decimal.Value,
): Decimal {
  return calculateSlippage(side, executionPrice, referencePrice).mul(10_000);
}

/** Calculates the bid/ask spread relative to the midpoint, in basis points. */
export function calculateSpreadBps(
  bestBid: Decimal.Value,
  bestAsk: Decimal.Value,
): Decimal {
  const bid = positiveDecimal(bestBid, 'bestBid');
  const ask = positiveDecimal(bestAsk, 'bestAsk');
  if (ask.lessThan(bid)) {
    throw new RangeError('bestAsk must be greater than or equal to bestBid');
  }
  return ask.minus(bid).div(ask.plus(bid).div(2)).mul(10_000);
}

export function buildExecutablePriceCurve(orderBook: OrderBook): OrderBookExecutablePriceCurve {
  const bestAsk = orderBook.asks[0]?.price;
  const bestBid = orderBook.bids[0]?.price;

  const buy = EXECUTABLE_NOTIONALS_USD.map((notionalUsd): ExecutablePricePoint => {
    const result = calculateBuyVwap(orderBook.asks, notionalUsd);
    const slippage = result.vwap !== null && bestAsk !== undefined
      ? calculateSlippage('buy', result.vwap, bestAsk)
      : null;
    return {
      ...result,
      notionalUsd,
      slippage,
      slippageBps: slippage?.mul(10_000) ?? null,
    };
  });

  const sell = EXECUTABLE_NOTIONALS_USD.map((notionalUsd): ExecutablePricePoint => {
    const result = calculateSellVwap(orderBook.bids, notionalUsd);
    const slippage = result.vwap !== null && bestBid !== undefined
      ? calculateSlippage('sell', result.vwap, bestBid)
      : null;
    return {
      ...result,
      notionalUsd,
      slippage,
      slippageBps: slippage?.mul(10_000) ?? null,
    };
  });

  return {
    kind: 'orderbook',
    marketId: orderBook.market.id,
    observedAt: orderBook.observedAt,
    buy,
    sell,
  };
}

/** @deprecated Use OrderBook. */
export type NormalizedOrderBook = OrderBook;
/** @deprecated Use OrderBookLevel. */
export type PriceLevel = OrderBookLevel;
/** @deprecated Use MarketQuote. */
export type MarketId = MarketQuote;
