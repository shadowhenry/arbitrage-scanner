import { Decimal } from '@arbitrage-scanner/core';
import type {
  ExecutionResult,
  FailureModelConfig,
  FailureReason,
  LegOutcome,
  RandomSource,
} from './sim-types.js';

/** Default failure assumptions for a conservative shadow simulation. */
export const DEFAULT_FAILURE_CONFIG: Readonly<FailureModelConfig> = {
  cexFailureRate: '0.002',
  dexFailureRate: '0.025',
  cexPartialFillRate: '0.005',
  unwindCostUsd: '5.00',
};

function validateProbability(value: Decimal.Value, name: string): Decimal {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative() || decimal.greaterThan(1)) {
    throw new RangeError(`${name} must be a finite decimal between 0 and 1`);
  }
  return decimal;
}

function validateConfig(config: FailureModelConfig): void {
  validateProbability(config.cexFailureRate, 'cexFailureRate');
  validateProbability(config.dexFailureRate, 'dexFailureRate');
  validateProbability(config.cexPartialFillRate, 'cexPartialFillRate');
  const unwindCost = new Decimal(config.unwindCostUsd);
  if (!unwindCost.isFinite() || unwindCost.isNegative()) {
    throw new RangeError('unwindCostUsd must be a non-negative finite decimal');
  }
}

function defaultRandom(): number {
  return Math.random();
}

/**
 * Samples the CEX leg outcome. A leg can be:
 * - 'executed': fully filled
 * - 'partial': partially filled (counts as a failure for arbitrage purposes)
 * - 'failed': rejected or not filled at all
 */
function sampleCexOutcome(
  config: FailureModelConfig,
  random: RandomSource,
): { outcome: LegOutcome; reason?: FailureReason } {
  const roll = random();
  const cexFail = new Decimal(config.cexFailureRate).toNumber();
  const cexPartial = new Decimal(config.cexPartialFillRate).toNumber();

  if (roll < cexFail) {
    return { outcome: 'failed', reason: 'cex-order-rejected' };
  }
  if (roll < cexFail + cexPartial) {
    return { outcome: 'partial', reason: 'cex-partial-fill' };
  }
  return { outcome: 'executed' };
}

/**
 * Samples the DEX (on-chain) leg outcome.
 */
function sampleDexOutcome(
  config: FailureModelConfig,
  random: RandomSource,
): { outcome: LegOutcome; reason?: FailureReason } {
  const roll = random();
  const dexFail = new Decimal(config.dexFailureRate).toNumber();

  if (roll < dexFail) {
    // Distribute failure reasons proportionally
    const reasonRoll = random();
    let reason: FailureReason;
    if (reasonRoll < 0.4) reason = 'slippage-exceeded';
    else if (reasonRoll < 0.7) reason = 'network-timeout';
    else if (reasonRoll < 0.9) reason = 'priority-fee-insufficient';
    else reason = 'dex-rpc-error';
    return { outcome: 'failed', reason };
  }
  return { outcome: 'executed' };
}

/**
 * Simulates the execution outcome of both legs of a CEX-DEX arbitrage.
 *
 * Uses independent Bernoulli trials for each leg. When one leg fails and
 * the other succeeds, the surviving leg must be unwound, incurring the
 * configured unwind cost.
 *
 * @param config Failure probability configuration
 * @param random Optional random source for deterministic testing
 * @returns Execution result with per-leg outcomes and optional unwind cost
 */
export function simulateExecutionOutcome(
  config: FailureModelConfig = DEFAULT_FAILURE_CONFIG,
  random: RandomSource = defaultRandom,
): ExecutionResult {
  validateConfig(config);

  const cex = sampleCexOutcome(config, random);
  const dex = sampleDexOutcome(config, random);

  const bothExecuted = cex.outcome === 'executed' && dex.outcome === 'executed';

  let failureReason: FailureReason | undefined;
  let unwindCostUsd: Decimal | undefined;

  if (!bothExecuted) {
    if (cex.outcome !== 'executed' && dex.outcome !== 'executed') {
      // Both failed — no inventory to unwind, but record the first failure
      failureReason = cex.reason ?? dex.reason ?? 'unknown';
    } else if (cex.outcome !== 'executed') {
      // CEX failed, DEX succeeded — need to unwind DEX position
      failureReason = cex.reason ?? 'unknown';
      unwindCostUsd = new Decimal(config.unwindCostUsd);
    } else {
      // DEX failed, CEX succeeded — need to unwind CEX position
      failureReason = dex.reason ?? 'unknown';
      unwindCostUsd = new Decimal(config.unwindCostUsd);
    }
  }

  return {
    cexOutcome: cex.outcome,
    dexOutcome: dex.outcome,
    bothExecuted,
    ...(failureReason === undefined ? {} : { failureReason }),
    ...(unwindCostUsd === undefined ? {} : { unwindCostUsd }),
  };
}

/**
 * Estimates the probability that both legs execute successfully.
 * This is the complement of (1 - P(cexFail)) × (1 - P(dexFail)),
 * where partial fills count as failures.
 */
export function estimateSuccessProbability(config: FailureModelConfig): Decimal {
  validateConfig(config);
  const cexSuccess = new Decimal(1)
    .minus(config.cexFailureRate)
    .minus(config.cexPartialFillRate);
  const dexSuccess = new Decimal(1).minus(config.dexFailureRate);
  return cexSuccess.mul(dexSuccess);
}
