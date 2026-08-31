import { Decimal } from '@arbitrage-scanner/core';
import type { GasCostBreakdown, GasModelConfig } from './sim-types.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000;

/** Default conservative gas assumptions for a Jupiter V6 swap on Solana. */
export const DEFAULT_GAS_CONFIG: Readonly<Omit<GasModelConfig, 'solPriceUsd'>> = {
  baseFeeLamports: 5_000,
  computeUnits: 400_000,
  priorityFeeMicroLamports: 50_000,
};

function validateConfig(config: GasModelConfig): void {
  if (!Number.isInteger(config.baseFeeLamports) || config.baseFeeLamports < 0) {
    throw new RangeError('baseFeeLamports must be a non-negative integer');
  }
  if (!Number.isInteger(config.computeUnits) || config.computeUnits <= 0) {
    throw new RangeError('computeUnits must be a positive integer');
  }
  if (!Number.isFinite(config.priorityFeeMicroLamports) || config.priorityFeeMicroLamports < 0) {
    throw new RangeError('priorityFeeMicroLamports must be a non-negative number');
  }
  const solPrice = new Decimal(config.solPriceUsd);
  if (!solPrice.isFinite() || !solPrice.greaterThan(0)) {
    throw new RangeError('solPriceUsd must be a positive finite decimal');
  }
}

/**
 * Calculates the total on-chain transaction cost for a Jupiter swap.
 *
 * Cost breakdown:
 * - Base fee: 5000 lamports per signature (Solana network default)
 * - Priority fee: computeUnits × (priorityFeeMicroLamports / 1_000_000) lamports
 *
 * Both are converted to SOL and then to USD using the provided SOL price.
 */
export function calculateGasCost(config: GasModelConfig): GasCostBreakdown {
  validateConfig(config);

  const priorityFeeLamports = Math.round(
    (config.computeUnits * config.priorityFeeMicroLamports) / MICRO_LAMPORTS_PER_LAMPORT,
  );
  const totalLamports = config.baseFeeLamports + priorityFeeLamports;
  const totalSol = new Decimal(totalLamports).div(LAMPORTS_PER_SOL);
  const totalUsd = totalSol.mul(config.solPriceUsd);

  return {
    baseFeeLamports: config.baseFeeLamports,
    priorityFeeLamports,
    totalLamports,
    totalSol,
    totalUsd,
  };
}

/**
 * Returns the priority fee in micro-lamports per compute unit that would
 * result in the given total USD cost. Useful for reverse-engineering what
 * priority fee is affordable given a target gas budget.
 */
export function priorityFeeForUsdBudget(
  budgetUsd: Decimal.Value,
  solPriceUsd: Decimal.Value,
  computeUnits: number,
  baseFeeLamports = 5_000,
): Decimal {
  const budget = new Decimal(budgetUsd);
  const price = new Decimal(solPriceUsd);
  if (!budget.isFinite() || budget.isNegative()) {
    throw new RangeError('budgetUsd must be a non-negative finite decimal');
  }
  if (!price.isFinite() || !price.greaterThan(0)) {
    throw new RangeError('solPriceUsd must be a positive finite decimal');
  }
  if (!Number.isInteger(computeUnits) || computeUnits <= 0) {
    throw new RangeError('computeUnits must be a positive integer');
  }

  const budgetLamports = budget.div(price).mul(LAMPORTS_PER_SOL);
  const availableForPriority = budgetLamports.minus(baseFeeLamports);
  if (availableForPriority.lessThanOrEqualTo(0)) return new Decimal(0);

  return availableForPriority
    .mul(MICRO_LAMPORTS_PER_LAMPORT)
    .div(computeUnits);
}
