import { describe, expect, it } from 'vitest';
import {
  buildExecutablePriceCurve,
  calculateBuyVwap,
  calculateSellVwap,
  calculateSlippage,
  calculateSlippageBps,
  calculateSpreadBps,
  Decimal,
  EXECUTABLE_NOTIONALS_USD,
  healthy,
  normalizeFundingRates,
  type OrderBook,
  type OrderBookLevel,
} from './index.js';

const level = (price: Decimal.Value, quantity: Decimal.Value): OrderBookLevel => ({
  price: new Decimal(price),
  quantity: new Decimal(quantity),
});

const book = (bids: readonly OrderBookLevel[], asks: readonly OrderBookLevel[]): OrderBook => {
  const observedAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    market: {
      id: 'test:BTC-USD',
      venue: { id: 'test', name: 'Test Venue', kind: 'cex' },
      marketType: 'spot',
      symbol: 'BTC-USD',
      baseAsset: { symbol: 'BTC' },
      quoteAsset: { symbol: 'USD' },
      observedAt,
    },
    bids,
    asks,
    observedAt,
  };
};

describe('health status', () => {
  it('creates a stable health status', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(healthy('core', now)).toEqual({
      service: 'core', status: 'ok', timestamp: now.toISOString(),
    });
  });
});

describe('funding normalization', () => {
  it('converts interval rates to hourly and simple annualized rates', () => {
    const funding = normalizeFundingRates('0.0008', 8);
    expect(funding.hourlyRate.toString()).toBe('0.0001');
    expect(funding.annualizedRate.toString()).toBe('0.876');
  });
});

describe('calculateBuyVwap', () => {
  it('fills an exact quote amount across multiple ask levels', () => {
    const result = calculateBuyVwap([level(100, 2), level(110, 3)], 420);

    expect(result.fullyExecutable).toBe(true);
    expect(result.levelsConsumed).toBe(2);
    expect(result.filledQuote.toString()).toBe('420');
    expect(result.baseQuantity.toString()).toBe('4');
    expect(result.vwap?.toString()).toBe('105');
  });

  it('supports a partial final level without binary floating-point drift', () => {
    const result = calculateBuyVwap([level('0.1', '3'), level('0.2', '5')], '0.4');

    expect(result.baseQuantity.toString()).toBe('3.5');
    expect(result.vwap?.toString()).toBe('0.11428571428571428571');
  });

  it('does not invent liquidity when asks are insufficient', () => {
    const result = calculateBuyVwap([level(100, 1)], 150);

    expect(result.fullyExecutable).toBe(false);
    expect(result.filledQuote.toString()).toBe('100');
    expect(result.vwap).toBeNull();
  });
});

describe('calculateSellVwap', () => {
  it('fills an exact proceeds target across multiple bid levels', () => {
    const result = calculateSellVwap([level(100, 2), level(90, 3)], 380);

    expect(result.fullyExecutable).toBe(true);
    expect(result.levelsConsumed).toBe(2);
    expect(result.filledQuote.toString()).toBe('380');
    expect(result.baseQuantity.toString()).toBe('4');
    expect(result.vwap?.toString()).toBe('95');
  });

  it('marks an insufficient bid book as not executable', () => {
    const result = calculateSellVwap([level(100, 1)], 101);

    expect(result.fullyExecutable).toBe(false);
    expect(result.baseQuantity.toString()).toBe('1');
    expect(result.vwap).toBeNull();
  });
});

describe('input validation', () => {
  it.each([0, -1, Number.POSITIVE_INFINITY])('rejects invalid notional %s', (value) => {
    expect(() => calculateBuyVwap([level(100, 1)], value)).toThrow(RangeError);
  });

  it('rejects invalid price and quantity levels', () => {
    expect(() => calculateBuyVwap([level(0, 1)], 10)).toThrow('levels[0].price');
    expect(() => calculateSellVwap([level(1, -1)], 10)).toThrow('levels[0].quantity');
  });
});

describe('market metrics', () => {
  it('calculates adverse buy and sell slippage', () => {
    expect(calculateSlippage('buy', 101, 100).toString()).toBe('0.01');
    expect(calculateSlippage('sell', 99, 100).toString()).toBe('0.01');
    expect(calculateSlippageBps('buy', 101, 100).toString()).toBe('100');
  });

  it('keeps price improvement negative', () => {
    expect(calculateSlippageBps('buy', 99, 100).toString()).toBe('-100');
    expect(calculateSlippageBps('sell', 101, 100).toString()).toBe('-100');
  });

  it('calculates spread against the midpoint', () => {
    expect(calculateSpreadBps(99, 101).toString()).toBe('200');
    expect(calculateSpreadBps(100, 100).toString()).toBe('0');
  });

  it('rejects a crossed quote and non-positive prices', () => {
    expect(() => calculateSpreadBps(101, 100)).toThrow('bestAsk');
    expect(() => calculateSpreadBps(0, 100)).toThrow('bestBid');
  });
});

describe('buildExecutablePriceCurve', () => {
  it('calculates every required USD notional for both sides', () => {
    const orderBook = book(
      [level(99, 100), level(98, 200)],
      [level(101, 100), level(102, 200)],
    );
    const curve = buildExecutablePriceCurve(orderBook);

    expect(curve.marketId).toBe('test:BTC-USD');
    expect(curve.buy.map((point) => point.notionalUsd)).toEqual(EXECUTABLE_NOTIONALS_USD);
    expect(curve.sell.map((point) => point.notionalUsd)).toEqual(EXECUTABLE_NOTIONALS_USD);
    expect(curve.buy[0]?.vwap?.toString()).toBe('101');
    expect(curve.buy[0]?.slippageBps?.toString()).toBe('0');
    expect(curve.buy.at(-1)?.fullyExecutable).toBe(true);
    expect(curve.sell.at(-1)?.fullyExecutable).toBe(true);
  });

  it('returns null metrics at notionals beyond visible depth', () => {
    const curve = buildExecutablePriceCurve(book([level(99, 1)], [level(101, 1)]));
    const buy100 = curve.buy[0];
    const buy500 = curve.buy[1];

    expect(buy100?.fullyExecutable).toBe(true);
    expect(buy500?.fullyExecutable).toBe(false);
    expect(buy500?.vwap).toBeNull();
    expect(buy500?.slippage).toBeNull();
    expect(buy500?.slippageBps).toBeNull();
  });

  it('handles an empty book without treating it as executable', () => {
    const curve = buildExecutablePriceCurve(book([], []));

    expect(curve.buy.every((point) => !point.fullyExecutable && point.vwap === null)).toBe(true);
    expect(curve.sell.every((point) => !point.fullyExecutable && point.vwap === null)).toBe(true);
  });
});
