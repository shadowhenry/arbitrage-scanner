import { describe, expect, it } from 'vitest';
import {
  applyTrade,
  canExecute,
  checkRebalanceNeeded,
  createInitialInventory,
  maxExecutableNotionalUsd,
  snapshotInventory,
  totalInventoryValueUsd,
} from './sim-inventory.js';
import type { InventoryTarget } from './sim-types.js';

const SOL_PRICE = '150';

describe('inventory model', () => {
  it('creates initial inventory with pre-funded balances', () => {
    const state = createInitialInventory('10000', '10', '10000', '10');
    expect(state.cexUsdc.toNumber()).toBe(10000);
    expect(state.cexSol.toNumber()).toBe(10);
    expect(state.chainUsdc.toNumber()).toBe(10000);
    expect(state.chainSol.toNumber()).toBe(10);
  });

  it('rejects negative inventory balances', () => {
    expect(() => createInitialInventory('-1', '10', '10000', '10'))
      .toThrow('cexUsdc must be a non-negative finite decimal');
  });

  it('checks executability for cex-buy-dex-sell direction', () => {
    const state = createInitialInventory('1000', '0', '0', '5');
    // cex-buy needs USDC on CEX, dex-sell needs SOL on chain
    expect(canExecute(state, 'cex-buy-dex-sell', '500', '3')).toBe(true);
    // Not enough USDC on CEX
    expect(canExecute(state, 'cex-buy-dex-sell', '2000', '3')).toBe(false);
    // Not enough SOL on chain
    expect(canExecute(state, 'cex-buy-dex-sell', '500', '10')).toBe(false);
  });

  it('checks executability for dex-buy-cex-sell direction', () => {
    const state = createInitialInventory('0', '5', '1000', '0');
    // dex-buy needs USDC on chain, cex-sell needs SOL on CEX
    expect(canExecute(state, 'dex-buy-cex-sell', '500', '3')).toBe(true);
    expect(canExecute(state, 'dex-buy-cex-sell', '2000', '3')).toBe(false);
    expect(canExecute(state, 'dex-buy-cex-sell', '500', '10')).toBe(false);
  });

  it('applies cex-buy-dex-sell trade correctly', () => {
    const state = createInitialInventory('1000', '0', '0', '10');
    const updated = applyTrade(state, 'cex-buy-dex-sell', '500', '3');
    // CEX: USDC -500, SOL +3
    expect(updated.cexUsdc.toNumber()).toBe(500);
    expect(updated.cexSol.toNumber()).toBe(3);
    // Chain: USDC +500, SOL -3
    expect(updated.chainUsdc.toNumber()).toBe(500);
    expect(updated.chainSol.toNumber()).toBe(7);
  });

  it('applies dex-buy-cex-sell trade correctly', () => {
    const state = createInitialInventory('0', '10', '1000', '0');
    const updated = applyTrade(state, 'dex-buy-cex-sell', '500', '3');
    // CEX: USDC +500, SOL -3
    expect(updated.cexUsdc.toNumber()).toBe(500);
    expect(updated.cexSol.toNumber()).toBe(7);
    // Chain: USDC -500, SOL +3
    expect(updated.chainUsdc.toNumber()).toBe(500);
    expect(updated.chainSol.toNumber()).toBe(3);
  });

  it('throws when applying trade with insufficient inventory', () => {
    const state = createInitialInventory('100', '0', '0', '1');
    expect(() => applyTrade(state, 'cex-buy-dex-sell', '500', '3'))
      .toThrow('Insufficient inventory for requested trade');
  });

  it('calculates total inventory value mark-to-market', () => {
    const state = createInitialInventory('5000', '10', '5000', '10');
    // Total USDC = 10000, total SOL = 20, SOL price = 150
    // Total = 10000 + 20*150 = 13000
    const value = totalInventoryValueUsd(state, SOL_PRICE);
    expect(value.toNumber()).toBe(13000);
  });

  it('creates inventory snapshot with valuation', () => {
    const state = createInitialInventory('5000', '10', '5000', '10');
    const snapshot = snapshotInventory(state, SOL_PRICE);
    expect(snapshot.totalValueUsd.toNumber()).toBe(13000);
    expect(snapshot.solPriceUsd.toNumber()).toBe(150);
    expect(snapshot.state).toBe(state);
    expect(snapshot.observedAt).toBeInstanceOf(Date);
  });

  it('detects rebalance needed when allocation deviates beyond threshold', () => {
    // Target: 50/50 USDC/SOL on each venue, 50/50 CEX/chain
    const target: InventoryTarget = {
      cexUsdcRatio: '0.25',
      cexSolRatio: '0.25',
      chainUsdcRatio: '0.25',
      chainSolRatio: '0.25',
    };
    // State: all USDC on CEX, no SOL — massive deviation
    const state = createInitialInventory('10000', '0', '0', '0');
    const deviation = checkRebalanceNeeded(state, target, '100', SOL_PRICE);
    expect(deviation).not.toBeUndefined();
    expect(deviation?.toNumber()).toBeGreaterThan(100);
  });

  it('returns undefined when allocation is within threshold', () => {
    const target: InventoryTarget = {
      cexUsdcRatio: '0.25',
      cexSolRatio: '0.25',
      chainUsdcRatio: '0.25',
      chainSolRatio: '0.25',
    };
    // Balanced: 5000 USDC + ~33.33 SOL on each side (at $150)
    const state = createInitialInventory('5000', '33.33', '5000', '33.33');
    const deviation = checkRebalanceNeeded(state, target, '1000', SOL_PRICE);
    expect(deviation).toBeUndefined();
  });

  it('calculates max executable notional for cex-buy-dex-sell', () => {
    // CEX has 1000 USDC, chain has 5 SOL at $150 = $750
    const state = createInitialInventory('1000', '0', '0', '5');
    const max = maxExecutableNotionalUsd(state, 'cex-buy-dex-sell', SOL_PRICE);
    // Limited by chain SOL: 5 * 150 = 750
    expect(max.toNumber()).toBe(750);
  });

  it('calculates max executable notional for dex-buy-cex-sell', () => {
    // Chain has 1000 USDC, CEX has 3 SOL at $150 = $450
    const state = createInitialInventory('0', '3', '1000', '0');
    const max = maxExecutableNotionalUsd(state, 'dex-buy-cex-sell', SOL_PRICE);
    // Limited by CEX SOL: 3 * 150 = 450
    expect(max.toNumber()).toBe(450);
  });
});
