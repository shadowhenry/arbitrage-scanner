import {
  Decimal,
  normalizeFundingRates,
  type Asset,
  type FundingRate,
  type MarketQuote,
  type PerpMarket,
  type Venue,
} from '@arbitrage-scanner/core';
import type {
  HyperliquidFundingHistoryRecord,
  HyperliquidPerpContext,
  HyperliquidSpotContext,
  HyperliquidSpotMarketMeta,
  HyperliquidSpotToken,
} from './types.js';

export const HYPERLIQUID_VENUE: Venue = {
  id: 'hyperliquid', name: 'Hyperliquid', kind: 'dex',
};

export function nextHourlyFundingAt(timestamp: number): Date {
  return new Date((Math.floor(timestamp / 3_600_000) + 1) * 3_600_000);
}

export function normalizeHyperliquidFunding(
  marketId: string,
  hourlyRate: string,
  observedAt: Date,
  nextFundingAt = nextHourlyFundingAt(observedAt.getTime()),
): FundingRate {
  return {
    marketId,
    ...normalizeFundingRates(hourlyRate, 1),
    nextFundingAt,
    observedAt,
  };
}

export function normalizeHistoricalFunding(record: HyperliquidFundingHistoryRecord): FundingRate {
  const observedAt = new Date(record.time);
  return normalizeHyperliquidFunding(
    `hyperliquid:perpetual:${record.coin}`,
    record.fundingRate,
    observedAt,
    new Date(record.time + 3_600_000),
  );
}

export function normalizeHyperliquidPerp(
  coin: string,
  context: HyperliquidPerpContext,
  observedAt: Date,
  bestBid?: string,
  bestAsk?: string,
): PerpMarket {
  const marketId = `hyperliquid:perpetual:${coin}`;
  return {
    id: marketId,
    venue: HYPERLIQUID_VENUE,
    marketType: 'perpetual',
    symbol: `${coin}-USD`,
    baseAsset: { symbol: coin },
    quoteAsset: { symbol: 'USD' },
    ...(bestBid === undefined ? {} : { bestBid: new Decimal(bestBid) }),
    ...(bestAsk === undefined ? {} : { bestAsk: new Decimal(bestAsk) }),
    markPrice: new Decimal(context.markPx),
    indexPrice: new Decimal(context.oraclePx),
    fundingRate: normalizeHyperliquidFunding(marketId, context.funding, observedAt),
    observedAt,
  };
}

export function normalizeHyperliquidSpot(
  market: HyperliquidSpotMarketMeta,
  baseToken: HyperliquidSpotToken,
  quoteToken: HyperliquidSpotToken,
  context: HyperliquidSpotContext,
  observedAt: Date,
  bestBid?: string,
  bestAsk?: string,
): MarketQuote {
  const base: Asset = { symbol: baseToken.name, decimals: baseToken.szDecimals };
  const quote: Asset = { symbol: quoteToken.name, decimals: quoteToken.szDecimals };
  return {
    id: `hyperliquid:spot:${market.name}`,
    venue: HYPERLIQUID_VENUE,
    marketType: 'spot',
    symbol: `${base.symbol}/${quote.symbol}`,
    baseAsset: base,
    quoteAsset: quote,
    ...(bestBid === undefined ? {} : { bestBid: new Decimal(bestBid) }),
    ...(bestAsk === undefined ? {} : { bestAsk: new Decimal(bestAsk) }),
    lastPrice: new Decimal(context.markPx),
    observedAt,
  };
}

