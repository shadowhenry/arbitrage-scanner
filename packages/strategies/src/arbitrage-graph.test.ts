import {
  Decimal,
  EXECUTABLE_NOTIONALS_USD,
  type ExecutableRoutePoint,
  type MarketQuote,
  type OrderBook,
  type RoutingExecutablePriceCurve,
  type Venue,
} from '@arbitrage-scanner/core';
import { describe, expect, it } from 'vitest';
import {
  buildArbitrageGraph,
  scanArbitrageGraph,
  type ArbitrageGraphNode,
  type OrderBookGraphNode,
  type RoutingGraphNode,
} from './arbitrage-graph.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const USD = { symbol: 'USDC', decimals: 6 } as const;
const BTC = { symbol: 'BTC', decimals: 8 } as const;

function venue(id: string, kind: Venue['kind']): Venue { return { id, name: id, kind }; }

function orderBookNode(
  id: string,
  venueId: string,
  marketType: 'spot' | 'perpetual',
  bid: string,
  ask: string,
  funding = '0',
): OrderBookGraphNode {
  const market: MarketQuote = {
    id, venue: venue(venueId, 'cex'), marketType, symbol: 'BTC-USDC', baseAsset: BTC,
    quoteAsset: USD, observedAt: NOW,
  };
  const orderBook: OrderBook = {
    market,
    bids: [{ price: new Decimal(bid), quantity: new Decimal(10_000) }],
    asks: [{ price: new Decimal(ask), quantity: new Decimal(10_000) }],
    observedAt: NOW,
  };
  return {
    id, venue: market.venue, marketType, baseAsset: BTC, quoteAsset: USD,
    takerFeeRate: '0.0001', observedAt: NOW, executionKind: 'orderbook', orderBook,
    ...(marketType === 'perpetual' ? { hourlyFundingRate: funding, fundingObservedAt: NOW } : {}),
  };
}

function curve(
  marketId: string,
  side: 'buy' | 'sell',
  multiplier: string,
): RoutingExecutablePriceCurve {
  const quotes = EXECUTABLE_NOTIONALS_USD.map((notionalUsd): ExecutableRoutePoint => {
    const usd = new Decimal(notionalUsd);
    const base = usd.div(100);
    const inputAmount = side === 'buy' ? usd : base;
    const outputAmount = side === 'buy' ? base : usd.mul(multiplier);
    return {
      notionalUsd, inputAmount, outputAmount,
      effectivePrice: side === 'buy' ? usd.div(base) : outputAmount.div(base),
      priceImpact: new Decimal(0), route: [], dexLabels: ['fixture'], quoteTimestamp: NOW,
    };
  });
  return {
    kind: 'routing', marketId, observedAt: NOW,
    inputAsset: side === 'buy' ? USD : BTC,
    outputAsset: side === 'buy' ? BTC : USD,
    quotes,
  };
}

function dexNode(id: string, sellMultiplier: string): RoutingGraphNode {
  return {
    id, venue: venue(id, 'dex'), marketType: 'spot', baseAsset: BTC, quoteAsset: USD,
    takerFeeRate: 0, observedAt: NOW, executionKind: 'routing',
    buyCurve: curve(`${id}:buy`, 'buy', '1'),
    sellCurve: curve(`${id}:sell`, 'sell', sellMultiplier),
  };
}

describe('unified arbitrage graph', () => {
  const nodes: readonly ArbitrageGraphNode[] = [
    orderBookNode('binance:spot', 'binance', 'spot', '99', '100'),
    orderBookNode('bybit:spot', 'bybit', 'spot', '103', '104'),
    orderBookNode('binance:perp', 'binance-usdm', 'perpetual', '105', '106', '0.0002'),
    orderBookNode('bybit:perp', 'bybit-linear', 'perpetual', '107', '108', '0.0005'),
    dexNode('jupiter', '1.02'),
    dexNode('raydium', '1.03'),
  ];

  it('creates buy and sell operation edges for all capital buckets', () => {
    const graph = buildArbitrageGraph(nodes);
    const binanceEdges = graph.edges.filter((edge) => edge.nodeId === 'binance:spot');
    expect(binanceEdges).toHaveLength(EXECUTABLE_NOTIONALS_USD.length * 2);
    expect(new Set(binanceEdges.map((edge) => edge.capitalBucketUsd)))
      .toEqual(new Set(EXECUTABLE_NOTIONALS_USD));
  });

  it('generates S1-S5 combinations for common assets without executing trades', () => {
    const opportunities = scanArbitrageGraph(nodes, { now: NOW, includeDerivativeExitFees: false });
    expect(new Set(opportunities.map((item) => item.strategyId)))
      .toEqual(new Set(['S1', 'S2', 'S3', 'S4', 'S5']));
    expect(new Set(opportunities.map((item) => item.capitalBucketUsd)))
      .toEqual(new Set(EXECUTABLE_NOTIONALS_USD));
    expect(opportunities.every((item) => item.legs.length === 2)).toBe(true);
  });

  it('includes normalized funding and fees in expected profit', () => {
    const opportunities = scanArbitrageGraph(nodes, {
      now: NOW, fundingHorizonHours: 8, includeDerivativeExitFees: false,
    });
    const s2 = opportunities.find((item) =>
      item.strategyId === 'S2' && item.buyNodeId === 'binance:perp' && item.sellNodeId === 'bybit:perp'
      && item.capitalBucketUsd === 100);
    expect(s2?.fundingProfitUsd.greaterThan(0)).toBe(true);
    expect(s2?.entryFeesUsd.greaterThan(0)).toBe(true);
    expect(s2?.expectedProfitUsd.toString()).toBe(
      s2?.grossTradeProfitUsd.plus(s2.fundingProfitUsd).minus(s2.entryFeesUsd).toString(),
    );
  });

  it('ranks by expected profit and uses return on capital as the tie-breaker', () => {
    const opportunities = scanArbitrageGraph(nodes, { now: NOW, includeDerivativeExitFees: false });
    for (let index = 1; index < opportunities.length; index += 1) {
      const previous = opportunities[index - 1];
      const current = opportunities[index];
      if (previous === undefined || current === undefined) continue;
      const profitComparison = previous.expectedProfitUsd.comparedTo(current.expectedProfitUsd);
      expect(profitComparison).toBeGreaterThanOrEqual(0);
      if (profitComparison === 0) {
        expect(previous.returnOnCapital.comparedTo(current.returnOnCapital)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rejects Polymarket and any other prediction node', () => {
    const prediction = {
      ...orderBookNode('polymarket:test', 'polymarket', 'spot', '0.4', '0.5'),
      venue: venue('polymarket', 'prediction'),
    } as ArbitrageGraphNode;
    expect(() => buildArbitrageGraph([prediction])).toThrow('Prediction markets');
  });

  it('does not interpolate mismatched fixed DEX route quantities', () => {
    const mismatched = dexNode('mismatched', '1.031');
    const sellCurve = mismatched.sellCurve;
    if (sellCurve === undefined) throw new Error('fixture sell curve missing');
    const altered: RoutingGraphNode = {
      ...mismatched,
      sellCurve: {
        ...sellCurve,
        quotes: sellCurve.quotes.map((point) => ({ ...point, inputAmount: point.inputAmount.mul('0.99') })),
      },
    };
    const results = scanArbitrageGraph([dexNode('matched', '1'), altered], {
      now: NOW, requirePositiveProfit: false,
    });
    expect(results.filter((item) =>
      item.strategyId === 'S5' && item.buyNodeId === 'matched' && item.sellNodeId === 'mismatched'))
      .toEqual([]);
  });
});
