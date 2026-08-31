import { describe, expect, it } from 'vitest';
import {
  calculateGasCost,
  DEFAULT_GAS_CONFIG,
  priorityFeeForUsdBudget,
} from './sim-gas-model.js';

describe('gas model', () => {
  it('calculates base fee only when priority fee is zero', () => {
    const result = calculateGasCost({
      ...DEFAULT_GAS_CONFIG,
      priorityFeeMicroLamports: 0,
      solPriceUsd: '100',
    });
    expect(result.baseFeeLamports).toBe(5_000);
    expect(result.priorityFeeLamports).toBe(0);
    expect(result.totalLamports).toBe(5_000);
    expect(result.totalSol.toNumber()).toBeCloseTo(0.000005, 10);
    expect(result.totalUsd.toNumber()).toBeCloseTo(0.0005, 6);
  });

  it('calculates priority fee as computeUnits × microLamports / 1e6', () => {
    const result = calculateGasCost({
      baseFeeLamports: 5_000,
      computeUnits: 400_000,
      priorityFeeMicroLamports: 50_000,
      solPriceUsd: '150',
    });
    // 400000 * 50000 / 1000000 = 20000 lamports
    expect(result.priorityFeeLamports).toBe(20_000);
    expect(result.totalLamports).toBe(25_000);
    expect(result.totalSol.toNumber()).toBeCloseTo(0.000025, 10);
    expect(result.totalUsd.toNumber()).toBeCloseTo(0.00375, 6);
  });

  it('handles high congestion priority fees', () => {
    const result = calculateGasCost({
      baseFeeLamports: 5_000,
      computeUnits: 600_000,
      priorityFeeMicroLamports: 500_000,
      solPriceUsd: '200',
    });
    // 600000 * 500000 / 1000000 = 300000 lamports
    expect(result.priorityFeeLamports).toBe(300_000);
    expect(result.totalLamports).toBe(305_000);
    expect(result.totalUsd.toNumber()).toBeCloseTo(0.061, 5);
  });

  it('throws on invalid config', () => {
    expect(() => calculateGasCost({
      ...DEFAULT_GAS_CONFIG,
      solPriceUsd: '-1',
    })).toThrow('solPriceUsd must be a positive finite decimal');

    expect(() => calculateGasCost({
      ...DEFAULT_GAS_CONFIG,
      computeUnits: 0,
      solPriceUsd: '100',
    })).toThrow('computeUnits must be a positive integer');

    expect(() => calculateGasCost({
      ...DEFAULT_GAS_CONFIG,
      priorityFeeMicroLamports: -1,
      solPriceUsd: '100',
    })).toThrow('priorityFeeMicroLamports must be a non-negative number');
  });

  it('reverse-calculates priority fee for a USD budget', () => {
    const priorityFee = priorityFeeForUsdBudget('0.005', '100', 400_000, 5_000);
    // Budget $0.005 at $100 SOL = 0.00005 SOL = 50000 lamports
    // Minus base 5000 = 45000 lamports for priority
    // 45000 * 1e6 / 400000 = 112500 micro-lamports
    expect(priorityFee.toNumber()).toBeCloseTo(112_500, 0);
  });

  it('returns zero priority fee when budget only covers base fee', () => {
    // $0.0005 at $100 SOL = 5000 lamports = exactly base fee
    const priorityFee = priorityFeeForUsdBudget('0.0005', '100', 400_000, 5_000);
    expect(priorityFee.toNumber()).toBe(0);
  });

  it('returns zero priority fee when budget is below base fee', () => {
    const priorityFee = priorityFeeForUsdBudget('0.0001', '100', 400_000, 5_000);
    expect(priorityFee.toNumber()).toBe(0);
  });
});
