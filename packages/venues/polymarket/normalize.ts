import {
  Decimal,
  type Asset,
  type MarketQuote,
  type OrderBook,
  type PredictionFeeInformation,
  type PredictionMarket,
} from '@arbitrage-scanner/core';
import type {
  ClobOrderBookResponse,
  DiscoveredPolymarketMarket,
  GammaMarketResponse,
} from './types.js';
import { POLYMARKET_VENUE } from './types.js';

const USDC: Asset = { symbol: 'USDC', name: 'USD Coin', decimals: 6, network: 'polygon' };

function parseStringArray(value: string, field: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new TypeError(`${field} must be a JSON string array`);
  }
  return parsed;
}

export function normalizeGammaMarket(raw: GammaMarketResponse, now: Date): DiscoveredPolymarketMarket {
  const outcomes = parseStringArray(raw.outcomes, 'outcomes');
  const tokenIds = parseStringArray(raw.clobTokenIds, 'clobTokenIds');
  const yesIndex = outcomes.findIndex((outcome) => outcome.toUpperCase() === 'YES');
  const noIndex = outcomes.findIndex((outcome) => outcome.toUpperCase() === 'NO');
  const yesTokenId = tokenIds[yesIndex];
  const noTokenId = tokenIds[noIndex];
  if (yesTokenId === undefined || noTokenId === undefined) throw new TypeError('Market is not binary YES/NO');
  const outcomeAssets = outcomes.map((name, index) => ({
    id: tokenIds[index] ?? `${raw.conditionId}:${name}`,
    name,
    asset: {
      symbol: name.toUpperCase(), name, network: 'polygon',
      ...(tokenIds[index] === undefined ? {} : { contractAddress: tokenIds[index] }),
    },
  }));
  const resolvesAtValue = raw.endDateIso ?? raw.endDate;
  const resolvesAt = resolvesAtValue == null ? undefined : new Date(resolvesAtValue);
  if (resolvesAt !== undefined && Number.isNaN(resolvesAt.getTime())) throw new TypeError('Invalid resolution timestamp');
  const market: PredictionMarket = {
    id: `polymarket:${raw.conditionId}`,
    venue: POLYMARKET_VENUE,
    marketType: 'prediction',
    symbol: raw.slug ?? raw.conditionId,
    baseAsset: { symbol: 'COMPLETE_SET', name: raw.question ?? raw.conditionId },
    quoteAsset: USDC,
    observedAt: now,
    question: raw.question ?? raw.conditionId,
    outcomes: outcomeAssets,
    ...(resolvesAt === undefined ? {} : { resolvesAt }),
  };
  return {
    market,
    yesTokenId,
    noTokenId,
    feesEnabled: raw.feesEnabled ?? false,
    ...(raw.feeSchedule == null ? {} : { feeSchedule: raw.feeSchedule }),
  };
}

export function normalizeClobBook(
  raw: ClobOrderBookResponse,
  predictionMarket: PredictionMarket,
  outcome: 'YES' | 'NO',
): OrderBook {
  const timestamp = Number(raw.timestamp);
  const observedAt = new Date(timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp);
  if (Number.isNaN(observedAt.getTime())) throw new TypeError('Invalid CLOB timestamp');
  const baseAsset = predictionMarket.outcomes.find((item) => item.name.toUpperCase() === outcome)?.asset;
  if (baseAsset === undefined) throw new TypeError(`Missing ${outcome} outcome`);
  const market: MarketQuote = {
    ...predictionMarket,
    id: `${predictionMarket.id}:${outcome}`,
    symbol: `${predictionMarket.symbol}:${outcome}`,
    baseAsset,
    ...(raw.last_trade_price === undefined ? {} : { lastPrice: new Decimal(raw.last_trade_price) }),
  };
  const levels = (values: readonly { readonly price: string; readonly size: string }[]) => values
    .map(({ price, size }) => ({ price: new Decimal(price), quantity: new Decimal(size) }));
  return {
    market,
    bids: levels(raw.bids).sort((a, b) => b.price.comparedTo(a.price)),
    asks: levels(raw.asks).sort((a, b) => a.price.comparedTo(b.price)),
    observedAt,
    sequence: raw.hash,
  };
}

export function normalizePolymarketFee(
  outcomeId: string,
  baseFee: number,
  enabled: boolean,
  observedAt: Date,
  scheduledRate?: number,
  exponent = 1,
): PredictionFeeInformation {
  const base = new Decimal(baseFee);
  const takerFeeRate = enabled ? new Decimal(scheduledRate ?? base.div(1_000)) : new Decimal(0);
  const feeExponent = new Decimal(exponent);
  if (!base.isFinite() || base.isNegative() || !takerFeeRate.isFinite() || takerFeeRate.isNegative()
    || !feeExponent.isFinite() || feeExponent.isNegative()) {
    throw new TypeError('Invalid Polymarket fee information');
  }
  return { outcomeId, enabled, baseFee: base, takerFeeRate, exponent: feeExponent, observedAt };
}
