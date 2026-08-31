import { describe, expect, it } from 'vitest';
import {
  applyPriceDrift,
  DEFAULT_LATENCY_CONFIG,
  expectedDriftBps,
  simulateLatencyAndDrift,
} from './sim-latency-model.js';
import type { LatencyModelConfig, RandomSource } from './sim-types.js';

describe('latency model', () => {
  it('samples latency within configured ranges', () => {
    const config: LatencyModelConfig = {
      cexLatencyMinMs: 50,
      cexLatencyMaxMs: 200,
      dexLatencyMinMs: 400,
      dexLatencyMaxMs: 2000,
      solVolatilityPerSecond: '0.0004',
    };
    for (let i = 0; i < 50; i += 1) {
      const sample = simulateLatencyAndDrift(config);
      expect(sample.cexLatencyMs).toBeGreaterThanOrEqual(50);
      expect(sample.cexLatencyMs).toBeLessThanOrEqual(200);
      expect(sample.dexLatencyMs).toBeGreaterThanOrEqual(400);
      expect(sample.dexLatencyMs).toBeLessThanOrEqual(2000);
      expect(sample.effectiveLatencyMs).toBeGreaterThanOrEqual(sample.cexLatencyMs);
      expect(sample.effectiveLatencyMs).toBeGreaterThanOrEqual(sample.dexLatencyMs);
    }
  });

  it('uses max of cex and dex as effective latency', () => {
    // Deterministic: random = 0 → min values
    const alwaysZero: RandomSource = () => 0;
    const sample = simulateLatencyAndDrift(DEFAULT_LATENCY_CONFIG, alwaysZero);
    expect(sample.cexLatencyMs).toBe(50);
    expect(sample.dexLatencyMs).toBe(400);
    expect(sample.effectiveLatencyMs).toBe(400);
  });

  it('produces zero drift when volatility is zero', () => {
    const config: LatencyModelConfig = {
      ...DEFAULT_LATENCY_CONFIG,
      solVolatilityPerSecond: '0',
    };
    for (let i = 0; i < 20; i += 1) {
      const sample = simulateLatencyAndDrift(config);
      expect(sample.priceDriftBps.toNumber()).toBe(0);
      expect(sample.priceMultiplier.toNumber()).toBe(1);
    }
  });

  it('produces symmetric drift distribution around zero', () => {
    const config: LatencyModelConfig = {
      ...DEFAULT_LATENCY_CONFIG,
      solVolatilityPerSecond: '0.001',
    };
    let positiveCount = 0;
    let negativeCount = 0;
    for (let i = 0; i < 200; i += 1) {
      const sample = simulateLatencyAndDrift(config);
      if (sample.priceDriftBps.greaterThan(0)) positiveCount += 1;
      else if (sample.priceDriftBps.lessThan(0)) negativeCount += 1;
    }
    // Should have both positive and negative drifts
    expect(positiveCount).toBeGreaterThan(0);
    expect(negativeCount).toBeGreaterThan(0);
  });

  it('price multiplier is always positive', () => {
    for (let i = 0; i < 100; i += 1) {
      const sample = simulateLatencyAndDrift(DEFAULT_LATENCY_CONFIG);
      expect(sample.priceMultiplier.greaterThan(0)).toBe(true);
    }
  });

  it('applies price drift multiplier to execution price', () => {
    const drifted = applyPriceDrift('100', '1.005');
    expect(drifted.toNumber()).toBeCloseTo(100.5, 5);

    const negativeDrift = applyPriceDrift('100', '0.995');
    expect(negativeDrift.toNumber()).toBeCloseTo(99.5, 5);
  });

  it('throws on invalid execution price or multiplier', () => {
    expect(() => applyPriceDrift('-1', '1.0')).toThrow('executionPrice must be a positive finite decimal');
    expect(() => applyPriceDrift('100', '0')).toThrow('priceMultiplier must be a positive finite decimal');
    expect(() => applyPriceDrift('100', '-0.5')).toThrow('priceMultiplier must be a positive finite decimal');
  });

  it('estimates expected absolute drift magnitude', () => {
    // 1000ms latency, 0.001 vol/sec
    // std dev = 0.001 * sqrt(1) = 0.001
    // expected abs = 0.001 * sqrt(2/pi) ≈ 0.0007979
    // in bps = 7.979
    const drift = expectedDriftBps(1000, '0.001');
    expect(drift.toNumber()).toBeCloseTo(7.979, 2);
  });

  it('expected drift scales with sqrt of latency', () => {
    const drift1s = expectedDriftBps(1000, '0.001');
    const drift4s = expectedDriftBps(4000, '0.001');
    // 4x latency → 2x drift (sqrt relationship)
    expect(drift4s.div(drift1s).toNumber()).toBeCloseTo(2, 3);
  });

  it('expected drift is zero when volatility is zero', () => {
    const drift = expectedDriftBps(2000, '0');
    expect(drift.toNumber()).toBe(0);
  });

  it('throws on invalid latency config', () => {
    expect(() => simulateLatencyAndDrift({
      ...DEFAULT_LATENCY_CONFIG,
      cexLatencyMaxMs: 10,
      cexLatencyMinMs: 50,
    })).toThrow('cexLatencyMaxMs must be >= cexLatencyMinMs');

    expect(() => simulateLatencyAndDrift({
      ...DEFAULT_LATENCY_CONFIG,
      solVolatilityPerSecond: '-0.001',
    })).toThrow('solVolatilityPerSecond must be a non-negative finite decimal');
  });

  it('handles zero latency (instant execution)', () => {
    const config: LatencyModelConfig = {
      cexLatencyMinMs: 0,
      cexLatencyMaxMs: 0,
      dexLatencyMinMs: 0,
      dexLatencyMaxMs: 0,
      solVolatilityPerSecond: '0.001',
    };
    const sample = simulateLatencyAndDrift(config);
    expect(sample.effectiveLatencyMs).toBe(0);
    // Zero latency → zero drift regardless of volatility
    expect(sample.priceDriftBps.toNumber()).toBe(0);
  });
});
