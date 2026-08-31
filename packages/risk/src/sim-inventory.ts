import { Decimal } from '@arbitrage-scanner/core';
import type {
  ArbitrageDirection,
  InventorySnapshot,
  InventoryState,
  InventoryTarget,
} from './sim-types.js';

/**
 * Creates an initial inventory state with pre-funded balances on both
 * CEX and on-chain venues. This models the "pre-funded inventory" pattern
 * where capital is staged on both sides before arbitrage begins.
 */
export function createInitialInventory(
  cexUsdc: Decimal.Value,
  cexSol: Decimal.Value,
  chainUsdc: Decimal.Value,
  chainSol: Decimal.Value,
): InventoryState {
  const state: InventoryState = {
    cexUsdc: new Decimal(cexUsdc),
    cexSol: new Decimal(cexSol),
    chainUsdc: new Decimal(chainUsdc),
    chainSol: new Decimal(chainSol),
  };
  validateInventory(state);
  return state;
}

function validateInventory(state: InventoryState): void {
  for (const [key, value] of Object.entries(state)) {
    const decimal = value as Decimal;
    if (!decimal.isFinite() || decimal.isNegative()) {
      throw new RangeError(`${key} must be a non-negative finite decimal`);
    }
  }
}

/**
 * Checks whether the inventory can support a given arbitrage direction
 * for the specified notional size.
 *
 * For 'cex-buy-dex-sell':
 *   - CEX needs enough USDC to buy SOL
 *   - Chain needs enough SOL to sell
 *
 * For 'dex-buy-cex-sell':
 *   - Chain needs enough USDC to buy SOL
 *   - CEX needs enough SOL to sell
 */
export function canExecute(
  state: InventoryState,
  direction: ArbitrageDirection,
  usdcNotional: Decimal.Value,
  solQuantity: Decimal.Value,
): boolean {
  const usdc = new Decimal(usdcNotional);
  const sol = new Decimal(solQuantity);
  if (!usdc.isFinite() || usdc.lessThanOrEqualTo(0)) return false;
  if (!sol.isFinite() || sol.lessThanOrEqualTo(0)) return false;

  if (direction === 'cex-buy-dex-sell') {
    return state.cexUsdc.greaterThanOrEqualTo(usdc)
      && state.chainSol.greaterThanOrEqualTo(sol);
  }
  return state.chainUsdc.greaterThanOrEqualTo(usdc)
    && state.cexSol.greaterThanOrEqualTo(sol);
}

/**
 * Applies a completed arbitrage trade to the inventory state.
 *
 * For 'cex-buy-dex-sell':
 *   - CEX: USDC decreases, SOL increases
 *   - Chain: SOL decreases, USDC increases
 *
 * For 'dex-buy-cex-sell':
 *   - Chain: USDC decreases, SOL increases
 *   - CEX: SOL decreases, USDC increases
 */
export function applyTrade(
  state: InventoryState,
  direction: ArbitrageDirection,
  usdcNotional: Decimal.Value,
  solQuantity: Decimal.Value,
): InventoryState {
  const usdc = new Decimal(usdcNotional);
  const sol = new Decimal(solQuantity);
  if (!usdc.isFinite() || usdc.lessThanOrEqualTo(0)) {
    throw new RangeError('usdcNotional must be a positive finite decimal');
  }
  if (!sol.isFinite() || sol.lessThanOrEqualTo(0)) {
    throw new RangeError('solQuantity must be a positive finite decimal');
  }
  if (!canExecute(state, direction, usdc, sol)) {
    throw new Error('Insufficient inventory for requested trade');
  }

  if (direction === 'cex-buy-dex-sell') {
    return {
      cexUsdc: state.cexUsdc.minus(usdc),
      cexSol: state.cexSol.plus(sol),
      chainUsdc: state.chainUsdc.plus(usdc),
      chainSol: state.chainSol.minus(sol),
    };
  }
  return {
    cexUsdc: state.cexUsdc.plus(usdc),
    cexSol: state.cexSol.minus(sol),
    chainUsdc: state.chainUsdc.minus(usdc),
    chainSol: state.chainSol.plus(sol),
  };
}

/**
 * Calculates the total inventory value in USD, mark-to-market at the
 * given SOL price. USDC is treated as 1:1 with USD.
 */
export function totalInventoryValueUsd(
  state: InventoryState,
  solPriceUsd: Decimal.Value,
): Decimal {
  const price = new Decimal(solPriceUsd);
  if (!price.isFinite() || !price.greaterThan(0)) {
    throw new RangeError('solPriceUsd must be a positive finite decimal');
  }
  const totalUsdc = state.cexUsdc.plus(state.chainUsdc);
  const totalSol = state.cexSol.plus(state.chainSol);
  return totalUsdc.plus(totalSol.mul(price));
}

/**
 * Creates an inventory snapshot with mark-to-market valuation.
 */
export function snapshotInventory(
  state: InventoryState,
  solPriceUsd: Decimal.Value,
  observedAt: Date = new Date(),
): InventorySnapshot {
  return {
    state,
    totalValueUsd: totalInventoryValueUsd(state, solPriceUsd),
    solPriceUsd: new Decimal(solPriceUsd),
    observedAt,
  };
}

/**
 * Determines whether a rebalance is needed based on how far the current
 * allocation deviates from the target. Returns the deviation in basis
 * points, or undefined if within threshold.
 *
 * A rebalance is triggered when any venue's USDC/SOL ratio deviates from
 * target by more than the threshold.
 */
export function checkRebalanceNeeded(
  state: InventoryState,
  target: InventoryTarget,
  thresholdBps: Decimal.Value,
  solPriceUsd: Decimal.Value,
): Decimal | undefined {
  const threshold = new Decimal(thresholdBps);
  if (!threshold.isFinite() || threshold.isNegative()) {
    throw new RangeError('thresholdBps must be a non-negative finite decimal');
  }

  const totalValue = totalInventoryValueUsd(state, solPriceUsd);
  if (totalValue.isZero()) return undefined;

  const cexUsdcActual = state.cexUsdc.div(totalValue);
  const cexSolActual = state.cexSol.mul(solPriceUsd).div(totalValue);
  const chainUsdcActual = state.chainUsdc.div(totalValue);
  const chainSolActual = state.chainSol.mul(solPriceUsd).div(totalValue);

  const deviations = [
    cexUsdcActual.minus(target.cexUsdcRatio).abs(),
    cexSolActual.minus(target.cexSolRatio).abs(),
    chainUsdcActual.minus(target.chainUsdcRatio).abs(),
    chainSolActual.minus(target.chainSolRatio).abs(),
  ];

  const maxDeviation = deviations.reduce((max, current) =>
    current.greaterThan(max) ? current : max, new Decimal(0));
  const maxDeviationBps = maxDeviation.mul(10_000);

  if (maxDeviationBps.greaterThan(threshold)) return maxDeviationBps;
  return undefined;
}

/**
 * Returns the maximum executable USDC notional for a given direction,
 * considering both USDC availability and SOL availability at the given
 * SOL price.
 */
export function maxExecutableNotionalUsd(
  state: InventoryState,
  direction: ArbitrageDirection,
  solPriceUsd: Decimal.Value,
): Decimal {
  const price = new Decimal(solPriceUsd);
  if (!price.isFinite() || !price.greaterThan(0)) {
    throw new RangeError('solPriceUsd must be a positive finite decimal');
  }

  if (direction === 'cex-buy-dex-sell') {
    const usdcLimited = state.cexUsdc;
    const solLimited = state.chainSol.mul(price);
    return Decimal.min(usdcLimited, solLimited);
  }
  const usdcLimited = state.chainUsdc;
  const solLimited = state.cexSol.mul(price);
  return Decimal.min(usdcLimited, solLimited);
}
