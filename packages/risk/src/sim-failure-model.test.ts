import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAILURE_CONFIG,
  estimateSuccessProbability,
  simulateExecutionOutcome,
} from './sim-failure-model.js';
import type { FailureReason, RandomSource } from './sim-types.js';

describe('failure model', () => {
  it('returns both executed when random rolls are above all thresholds', () => {
    const alwaysAbove: RandomSource = () => 0.99;
    const result = simulateExecutionOutcome(DEFAULT_FAILURE_CONFIG, alwaysAbove);
    expect(result.bothExecuted).toBe(true);
    expect(result.cexOutcome).toBe('executed');
    expect(result.dexOutcome).toBe('executed');
    expect(result.failureReason).toBeUndefined();
    expect(result.unwindCostUsd).toBeUndefined();
  });

  it('detects CEX failure and assigns unwind cost', () => {
    // First roll (CEX) = 0.001 → below cexFailureRate 0.002 → CEX failed
    // Second roll (DEX) = 0.99 → DEX executed
    const sequence = [0.001, 0.99];
    let index = 0;
    const random: RandomSource = () => sequence[index++] ?? 0.5;
    const result = simulateExecutionOutcome(DEFAULT_FAILURE_CONFIG, random);
    expect(result.bothExecuted).toBe(false);
    expect(result.cexOutcome).toBe('failed');
    expect(result.dexOutcome).toBe('executed');
    expect(result.failureReason).toBe('cex-order-rejected');
    expect(result.unwindCostUsd).not.toBeUndefined();
    expect(result.unwindCostUsd?.toNumber()).toBe(5.0);
  });

  it('detects DEX failure and assigns unwind cost', () => {
    // First roll (CEX) = 0.99 → CEX executed
    // Second roll (DEX) = 0.01 → below dexFailureRate 0.025 → DEX failed
    const sequence = [0.99, 0.01];
    let index = 0;
    const random: RandomSource = () => sequence[index++] ?? 0.5;
    const result = simulateExecutionOutcome(DEFAULT_FAILURE_CONFIG, random);
    expect(result.bothExecuted).toBe(false);
    expect(result.cexOutcome).toBe('executed');
    expect(result.dexOutcome).toBe('failed');
    expect(result.unwindCostUsd).not.toBeUndefined();
  });

  it('detects CEX partial fill as a failure', () => {
    // cexFailureRate = 0.002, cexPartialFillRate = 0.005
    // Roll 0.003 → above 0.002 but below 0.007 → partial
    const sequence = [0.003, 0.99];
    let index = 0;
    const random: RandomSource = () => sequence[index++] ?? 0.5;
    const result = simulateExecutionOutcome(DEFAULT_FAILURE_CONFIG, random);
    expect(result.cexOutcome).toBe('partial');
    expect(result.bothExecuted).toBe(false);
    expect(result.failureReason).toBe('cex-partial-fill');
  });

  it('distributes DEX failure reasons across categories', () => {
    const reasons = new Set<FailureReason>();
    for (let i = 0; i < 200; i += 1) {
      // Force DEX failure: first roll high (CEX ok), second roll low (DEX fail)
      // Third roll determines reason
      const sequence = [0.99, 0.001, i / 200];
      let index = 0;
      const random: RandomSource = () => sequence[index++] ?? 0.5;
      const result = simulateExecutionOutcome(DEFAULT_FAILURE_CONFIG, random);
      if (result.failureReason !== undefined) reasons.add(result.failureReason);
    }
    // Should see at least slippage-exceeded and network-timeout
    expect(reasons.has('slippage-exceeded')).toBe(true);
    expect(reasons.has('network-timeout')).toBe(true);
  });

  it('both failed does not incur unwind cost', () => {
    const sequence = [0.001, 0.001];
    let index = 0;
    const random: RandomSource = () => sequence[index++] ?? 0.5;
    const result = simulateExecutionOutcome(DEFAULT_FAILURE_CONFIG, random);
    expect(result.bothExecuted).toBe(false);
    expect(result.cexOutcome).toBe('failed');
    expect(result.dexOutcome).toBe('failed');
    expect(result.unwindCostUsd).toBeUndefined();
  });

  it('estimates success probability as product of per-leg success rates', () => {
    const probability = estimateSuccessProbability(DEFAULT_FAILURE_CONFIG);
    // CEX success = 1 - 0.002 - 0.005 = 0.993
    // DEX success = 1 - 0.025 = 0.975
    // Combined = 0.993 * 0.975 = 0.968175
    expect(probability.toNumber()).toBeCloseTo(0.968175, 6);
  });

  it('throws on invalid probability values', () => {
    expect(() => simulateExecutionOutcome({
      ...DEFAULT_FAILURE_CONFIG,
      cexFailureRate: '1.5',
    })).toThrow('cexFailureRate must be a finite decimal between 0 and 1');

    expect(() => simulateExecutionOutcome({
      ...DEFAULT_FAILURE_CONFIG,
      dexFailureRate: '-0.1',
    })).toThrow('dexFailureRate must be a finite decimal between 0 and 1');
  });

  it('handles zero failure rates (always succeeds)', () => {
    const result = simulateExecutionOutcome({
      cexFailureRate: '0',
      dexFailureRate: '0',
      cexPartialFillRate: '0',
      unwindCostUsd: '0',
    }, () => 0.0001);
    expect(result.bothExecuted).toBe(true);
  });
});
