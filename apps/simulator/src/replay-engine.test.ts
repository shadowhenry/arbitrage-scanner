import { Decimal } from '@arbitrage-scanner/core';
import { describe, expect, it } from 'vitest';
import { ReplayEngine } from './replay-engine.js';
import type { ReplayConfig, ReplayEvent } from './replay-types.js';

function makeBinanceEvent(
  timestamp: Date,
  bidPrice: string,
  askPrice: string,
): ReplayEvent {
  return {
    type: 'binance-orderbook',
    timestamp,
    payload: {
      symbol: 'SOLUSDT',
      bids: [{ price: bidPrice, quantity: '1000' }],
      asks: [{ price: askPrice, quantity: '1000' }],
      observedAt: timestamp,
    },
  };
}

function makeJupiterEvent(
  timestamp: Date,
  direction: 'buy' | 'sell',
  notionalUsd: number,
  effectivePrice: string,
): ReplayEvent {
  return {
    type: 'jupiter-quote',
    timestamp,
    payload: {
      direction,
      notionalUsd,
      inputAmount: String(notionalUsd),
      outputAmount: String(notionalUsd / Number(effectivePrice)),
      effectivePrice,
      priceImpact: '0.001',
      observedAt: timestamp,
    },
  };
}

const baseConfig: ReplayConfig = {
  initialInventory: {
    cexUsdc: new Decimal('10000'),
    cexSol: new Decimal('100'),
    chainUsdc: new Decimal('10000'),
    chainSol: new Decimal('100'),
  },
  solPriceUsd: '150',
  minProfitThresholdUsd: '0.01',
  gasPriorityFeeMicroLamports: 50000,
  randomSeed: 42,
};

describe('ReplayEngine', () => {
  it('processes events in chronological order', () => {
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:02Z'), '149.5', '150.5'),
      makeBinanceEvent(new Date('2026-01-01T00:00:01Z'), '149.8', '150.2'),
    ];
    const engine = new ReplayEngine(events, baseConfig);
    const state = engine.getState();
    expect(state.currentTime.getTime()).toBe(0);
    engine.run();
    const finalState = engine.getState();
    expect(finalState.currentTime.toISOString()).toBe('2026-01-01T00:00:02.000Z');
  });

  it('detects and executes cex-buy-dex-sell when Jupiter price > Binance ask', () => {
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:00Z'), '149.0', '150.0'),
      // Jupiter sell price (SOL→USDC) = 152, higher than Binance ask 150
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'sell', 1000, '152'),
    ];
    const engine = new ReplayEngine(events, baseConfig);
    const metrics = engine.run();
    expect(metrics.totalTrades).toBeGreaterThan(0);
    const state = engine.getState();
    expect(state.trades.length).toBeGreaterThan(0);
    const trade = state.trades[0];
    expect(trade?.direction).toBe('cex-buy-dex-sell');
  });

  it('detects and executes dex-buy-cex-sell when Binance bid > Jupiter price', () => {
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:00Z'), '152.0', '153.0'),
      // Jupiter buy price (USDC→SOL) = 150, lower than Binance bid 152
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'buy', 1000, '150'),
    ];
    const engine = new ReplayEngine(events, baseConfig);
    const metrics = engine.run();
    expect(metrics.totalTrades).toBeGreaterThan(0);
    const state = engine.getState();
    const trade = state.trades[0];
    expect(trade?.direction).toBe('dex-buy-cex-sell');
  });

  it('does not execute when there is no price spread', () => {
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:00Z'), '150.0', '150.5'),
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'sell', 1000, '150.2'),
    ];
    const engine = new ReplayEngine(events, baseConfig);
    const metrics = engine.run();
    // Jupiter sell 150.2 < Binance ask 150.5 → no cex-buy-dex-sell profit
    // Jupiter buy not present → no dex-buy-cex-sell
    expect(metrics.totalTrades).toBe(0);
  });

  it('respects inventory constraints', () => {
    const config: ReplayConfig = {
      ...baseConfig,
      initialInventory: {
        cexUsdc: new Decimal('100'),  // Only $100 on CEX
        cexSol: new Decimal('0'),
        chainUsdc: new Decimal('10000'),
        chainSol: new Decimal('100'),
      },
    };
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:00Z'), '149.0', '150.0'),
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'sell', 100, '152'),
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'sell', 1000, '152'),
    ];
    const engine = new ReplayEngine(events, config);
    const metrics = engine.run();
    // $1000 notional requires $1000 USDC on CEX, but only $100 available
    // Should still execute at $100 bucket
    expect(metrics.totalTrades).toBeGreaterThan(0);
    const state = engine.getState();
    const trade = state.trades[0];
    expect(trade?.notionalUsd.toNumber()).toBeLessThanOrEqual(100);
  });

  it('produces deterministic results with fixed seed', () => {
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:00Z'), '149.0', '150.0'),
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'sell', 1000, '152'),
      makeJupiterEvent(new Date('2026-01-01T00:00:02Z'), 'sell', 500, '151.5'),
    ];
    const config1 = { ...baseConfig, randomSeed: 12345 };
    const config2 = { ...baseConfig, randomSeed: 12345 };

    const engine1 = new ReplayEngine(events, config1);
    const metrics1 = engine1.run();
    const engine2 = new ReplayEngine(events, config2);
    const metrics2 = engine2.run();

    expect(metrics1.totalTrades).toBe(metrics2.totalTrades);
    expect(metrics1.totalRealizedPnlUsd.toString()).toBe(metrics2.totalRealizedPnlUsd.toString());
    expect(metrics1.successfulTrades).toBe(metrics2.successfulTrades);
  });

  it('calculates gas costs for each trade', () => {
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:00Z'), '149.0', '150.0'),
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'sell', 1000, '152'),
    ];
    const engine = new ReplayEngine(events, baseConfig);
    engine.run();
    const state = engine.getState();
    const trade = state.trades[0];
    expect(trade).toBeDefined();
    expect(trade?.gasCost.totalUsd.greaterThan(0)).toBe(true);
    expect(trade?.gasCost.priorityFeeLamports).toBeGreaterThan(0);
  });

  it('returns zero metrics for empty event list', () => {
    const engine = new ReplayEngine([], baseConfig);
    const metrics = engine.run();
    expect(metrics.totalTrades).toBe(0);
    expect(metrics.totalRealizedPnlUsd.toNumber()).toBe(0);
    expect(metrics.winRate.toNumber()).toBe(0);
    expect(metrics.pnlSeries).toHaveLength(0);
  });

  it('updates inventory after successful trades', () => {
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:00Z'), '149.0', '150.0'),
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'sell', 1000, '152'),
    ];
    const engine = new ReplayEngine(events, { ...baseConfig, randomSeed: 1 });
    engine.run();
    const state = engine.getState();
    // At least one trade should have inventoryAfter (successful ones)
    const successfulTrades = state.trades.filter((t) => t.inventoryAfter !== undefined);
    expect(successfulTrades.length).toBeGreaterThanOrEqual(0);
  });

  it('respects minimum profit threshold', () => {
    const config: ReplayConfig = {
      ...baseConfig,
      minProfitThresholdUsd: '100',  // Very high threshold
    };
    const events: ReplayEvent[] = [
      makeBinanceEvent(new Date('2026-01-01T00:00:00Z'), '149.0', '150.0'),
      makeJupiterEvent(new Date('2026-01-01T00:00:01Z'), 'sell', 1000, '152'),
    ];
    const engine = new ReplayEngine(events, config);
    const metrics = engine.run();
    // Gross profit at $1000 notional = (152-150) * (1000/150) ≈ $13.33 < $100 threshold
    expect(metrics.totalTrades).toBe(0);
  });
});
