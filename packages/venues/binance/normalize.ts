import {
  Decimal,
  normalizeFundingRates,
  type Asset,
  type FundingRate,
  type MarketQuote,
  type PerpMarket,
  type Venue,
} from '@arbitrage-scanner/core';
import type { BinanceBookTickerEvent, BinanceMarkPriceEvent } from './types.js';

export const BINANCE_VENUE: Venue = { id: 'binance', name: 'Binance', kind: 'cex' };
export const BINANCE_FUTURES_VENUE: Venue = {
  id: 'binance-usdm', name: 'Binance USD-M Futures', kind: 'cex',
};

export function splitUsdtSymbol(symbol: string): { base: Asset; quote: Asset } {
  if (!symbol.endsWith('USDT') || symbol.length <= 4) {
    throw new RangeError(`Unsupported Binance symbol: ${symbol}`);
  }
  return {
    base: { symbol: symbol.slice(0, -4) },
    quote: { symbol: 'USDT' },
  };
}

export function normalizeSpotQuote(event: BinanceBookTickerEvent, now = Date.now()): MarketQuote {
  const { base, quote } = splitUsdtSymbol(event.s);
  return {
    id: `binance:spot:${event.s}`,
    venue: BINANCE_VENUE,
    marketType: 'spot',
    symbol: event.s,
    baseAsset: base,
    quoteAsset: quote,
    bestBid: new Decimal(event.b),
    bestAsk: new Decimal(event.a),
    observedAt: new Date(event.E ?? event.T ?? now),
  };
}

export function normalizeFundingRate(event: BinanceMarkPriceEvent): FundingRate {
  return {
    marketId: `binance:perpetual:${event.s}`,
    ...normalizeFundingRates(event.r, 8),
    nextFundingAt: new Date(event.T),
    observedAt: new Date(event.E),
  };
}

export function normalizePerpMarket(
  mark: BinanceMarkPriceEvent,
  ticker?: BinanceBookTickerEvent,
): PerpMarket {
  const { base, quote } = splitUsdtSymbol(mark.s);
  return {
    id: `binance:perpetual:${mark.s}`,
    venue: BINANCE_FUTURES_VENUE,
    marketType: 'perpetual',
    symbol: mark.s,
    baseAsset: base,
    quoteAsset: quote,
    ...(ticker === undefined ? {} : {
      bestBid: new Decimal(ticker.b),
      bestAsk: new Decimal(ticker.a),
    }),
    indexPrice: new Decimal(mark.i),
    markPrice: new Decimal(mark.p),
    fundingRate: normalizeFundingRate(mark),
    observedAt: new Date(Math.max(mark.E, ticker?.E ?? ticker?.T ?? 0)),
  };
}
