import {
  Decimal,
  type BinaryPredictionMarketSnapshot,
  type MarketQuote,
  type OrderBook,
  type PredictionMarket,
} from '@arbitrage-scanner/core';
import { describe, expect, it } from 'vitest';
import { BINARY_ARBITRAGE_CAPITAL_USD, scanBinaryCompleteSetArbitrage } from './binary-complete-set.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const venue = { id: 'polymarket', name: 'Polymarket', kind: 'prediction' } as const;
const prediction: PredictionMarket = {
  id: 'polymarket:condition', venue, marketType: 'prediction', symbol: 'fixture',
  baseAsset: { symbol: 'COMPLETE_SET' }, quoteAsset: { symbol: 'USDC' }, observedAt: NOW,
  question: 'Fixture?', outcomes: [
    { id: 'yes', name: 'YES', asset: { symbol: 'YES' } },
    { id: 'no', name: 'NO', asset: { symbol: 'NO' } },
  ],
};

function book(outcome: 'YES' | 'NO', asks: readonly [string, string][]): OrderBook {
  const market: MarketQuote = {
    ...prediction, id: `${prediction.id}:${outcome}`, symbol: outcome,
    baseAsset: { symbol: outcome },
  };
  return {
    market, bids: [], asks: asks.map(([price, quantity]) => ({
      price: new Decimal(price), quantity: new Decimal(quantity),
    })), observedAt: NOW,
  };
}

function snapshot(
  yesAsks: readonly [string, string][],
  noAsks: readonly [string, string][],
  feeRate = '0',
): BinaryPredictionMarketSnapshot {
  return {
    market: prediction,
    yesOrderBook: book('YES', yesAsks),
    noOrderBook: book('NO', noAsks),
    yesFee: { outcomeId: 'yes', enabled: feeRate !== '0', baseFee: new Decimal(0), takerFeeRate: new Decimal(feeRate), exponent: new Decimal(1), observedAt: NOW },
    noFee: { outcomeId: 'no', enabled: feeRate !== '0', baseFee: new Decimal(0), takerFeeRate: new Decimal(feeRate), exponent: new Decimal(1), observedAt: NOW },
  };
}

describe('Binary Complete Set Arbitrage', () => {
  it('calculates both-leg VWAP for every capital tier and records depth capacity', () => {
    const opportunities = scanBinaryCompleteSetArbitrage([
      snapshot([['0.44', '200'], ['0.47', '5000']], [['0.45', '300'], ['0.48', '5000']]),
    ], { now: NOW, slippageBufferBps: 10 });

    expect(opportunities.map((item) => item.requestedCapitalUsd).sort((a, b) => a - b))
      .toEqual([...BINARY_ARBITRAGE_CAPITAL_USD]);
    const tier100 = opportunities.find((item) => item.requestedCapitalUsd === 100);
    const tier500 = opportunities.find((item) => item.requestedCapitalUsd === 500);
    expect(tier100?.yesVwap.toString()).toBe('0.44');
    expect(tier100?.noVwap.toString()).toBe('0.45');
    expect(tier100?.allInCostPerShare.lessThan(1)).toBe(true);
    expect(tier500?.yesVwap.greaterThan('0.44')).toBe(true);
    expect(tier100?.availableExecutableShares.toString()).toBe('5200');
    expect(tier100?.expectedProfitUsd.greaterThan(0)).toBe(true);
  });

  it('includes both taker fees using the price-sensitive protocol formula', () => {
    const [opportunity] = scanBinaryCompleteSetArbitrage([
      snapshot([['0.4', '1000']], [['0.5', '1000']], '0.04'),
    ], { now: NOW });
    expect(opportunity?.feePerShare.toString()).toBe('0.0196');
    expect(opportunity?.allInCostPerShare.toNumber()).toBeCloseTo(0.9196, 12);
  });

  it('rejects a complete set whose costs, fees and buffer are not below one', () => {
    const opportunities = scanBinaryCompleteSetArbitrage([
      snapshot([['0.51', '1000']], [['0.48', '1000']], '0.04'),
    ], { now: NOW, slippageBufferBps: 100 });
    expect(opportunities).toEqual([]);
  });

  it('caps executable capacity at the shallower outcome book', () => {
    const [opportunity] = scanBinaryCompleteSetArbitrage([
      snapshot([['0.4', '1000']], [['0.5', '125']]),
    ], { now: NOW });
    expect(opportunity?.availableExecutableShares.toString()).toBe('125');
    expect(opportunity?.executableShares.lessThanOrEqualTo(125)).toBe(true);
  });
});
