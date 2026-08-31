import { describe, expect, it } from 'vitest';
import { normalizeFundingRate, normalizePerpMarket, normalizeSpotQuote, splitUsdtSymbol } from './normalize.js';
import type { BinanceBookTickerEvent, BinanceMarkPriceEvent } from './types.js';

const ticker: BinanceBookTickerEvent = {
  e: 'bookTicker', E: 1_000, u: 12, s: 'BTCUSDT', b: '999.1', B: '2', a: '1000.2', A: '3',
};
const mark: BinanceMarkPriceEvent = {
  e: 'markPriceUpdate', E: 2_000, s: 'BTCUSDT', p: '1000.1', i: '1000.0', r: '0.0001', T: 3_000,
};

describe('Binance normalization', () => {
  it('normalizes Spot book ticker fields without floating-point conversion', () => {
    const quote = normalizeSpotQuote(ticker);
    expect(quote).toMatchObject({ id: 'binance:spot:BTCUSDT', marketType: 'spot', symbol: 'BTCUSDT' });
    expect(quote.bestBid?.toString()).toBe('999.1');
    expect(quote.bestAsk?.toString()).toBe('1000.2');
    expect(quote.baseAsset.symbol).toBe('BTC');
  });

  it('normalizes mark, index, funding rate and next funding timestamp', () => {
    const market = normalizePerpMarket(mark, ticker);
    expect(market.markPrice.toString()).toBe('1000.1');
    expect(market.indexPrice.toString()).toBe('1000');
    expect(market.bestBid?.toString()).toBe('999.1');
    expect(market.fundingRate?.rate.toString()).toBe('0.0001');
    expect(market.fundingRate?.hourlyRate.toString()).toBe('0.0000125');
    expect(market.fundingRate?.annualizedRate.toString()).toBe('0.1095');
    expect(market.fundingRate?.nextFundingAt?.getTime()).toBe(3_000);
    expect(normalizeFundingRate(mark).intervalHours.toString()).toBe('8');
  });

  it('rejects unsupported quote symbols', () => {
    expect(() => splitUsdtSymbol('BTCUSD')).toThrow('Unsupported Binance symbol');
  });
});
