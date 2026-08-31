import {
  Decimal,
  normalizeFundingRates,
  type Asset,
  type FundingRate,
  type MarketQuote,
  type PerpMarket,
  type Venue,
} from '@arbitrage-scanner/core';
import type { BybitTickerData } from './types.js';

export const BYBIT_VENUE: Venue = { id: 'bybit', name: 'Bybit', kind: 'cex' };
export const BYBIT_LINEAR_VENUE: Venue = {
  id: 'bybit-linear', name: 'Bybit Linear', kind: 'cex',
};

export function splitBybitUsdtSymbol(symbol: string): { base: Asset; quote: Asset } {
  if (!symbol.endsWith('USDT') || symbol.length <= 4) {
    throw new RangeError(`Unsupported Bybit symbol: ${symbol}`);
  }
  return { base: { symbol: symbol.slice(0, -4) }, quote: { symbol: 'USDT' } };
}

function required(data: BybitTickerData, key: keyof BybitTickerData): string {
  const value = data[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Bybit ticker is missing ${key}`);
  }
  return value;
}

export function normalizeBybitSpotTicker(data: BybitTickerData, observedAt: Date): MarketQuote {
  const { base, quote } = splitBybitUsdtSymbol(data.symbol);
  return {
    id: `bybit:spot:${data.symbol}`,
    venue: BYBIT_VENUE,
    marketType: 'spot',
    symbol: data.symbol,
    baseAsset: base,
    quoteAsset: quote,
    bestBid: new Decimal(required(data, 'bid1Price')),
    bestAsk: new Decimal(required(data, 'ask1Price')),
    lastPrice: new Decimal(required(data, 'lastPrice')),
    observedAt,
  };
}

export function normalizeBybitFundingRate(data: BybitTickerData, observedAt: Date): FundingRate {
  return {
    marketId: `bybit:perpetual:${data.symbol}`,
    ...normalizeFundingRates(
      required(data, 'fundingRate'),
      required(data, 'fundingIntervalHour'),
    ),
    nextFundingAt: new Date(Number(required(data, 'nextFundingTime'))),
    observedAt,
  };
}

export function normalizeBybitLinearTicker(data: BybitTickerData, observedAt: Date): PerpMarket {
  const { base, quote } = splitBybitUsdtSymbol(data.symbol);
  return {
    id: `bybit:perpetual:${data.symbol}`,
    venue: BYBIT_LINEAR_VENUE,
    marketType: 'perpetual',
    symbol: data.symbol,
    baseAsset: base,
    quoteAsset: quote,
    bestBid: new Decimal(required(data, 'bid1Price')),
    bestAsk: new Decimal(required(data, 'ask1Price')),
    lastPrice: new Decimal(required(data, 'lastPrice')),
    markPrice: new Decimal(required(data, 'markPrice')),
    indexPrice: new Decimal(required(data, 'indexPrice')),
    fundingRate: normalizeBybitFundingRate(data, observedAt),
    observedAt,
  };
}
