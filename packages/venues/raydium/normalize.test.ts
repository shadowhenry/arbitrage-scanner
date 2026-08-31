import { describe, expect, it } from 'vitest';
import { normalizeRaydiumQuote } from './normalize.js';
import { RAYDIUM_MARKETS, type RaydiumPoolInfo, type RaydiumQuoteData } from './types.js';

const market = RAYDIUM_MARKETS[0];
const data: RaydiumQuoteData = {
  swapType: 'BaseIn', inputMint: market.inputToken.contractAddress, inputAmount: '100000000',
  outputMint: market.outputToken.contractAddress, outputAmount: '500000000',
  otherAmountThreshold: '490000000', slippageBps: 50, priceImpactPct: '0.0025',
  routePlan: [
    { poolId: 'a', inputMint: 'usdc', outputMint: 'middle' },
    { poolId: 'b', inputMint: 'middle', outputMint: 'sol' },
    { poolId: 'a', inputMint: 'usdc', outputMint: 'middle' },
  ],
};

describe('normalizeRaydiumQuote', () => {
  it('deduplicates pools and sums route liquidity once', () => {
    const pools = new Map<string, RaydiumPoolInfo>([
      ['a', { id: 'a', type: 'CPMM', tvl: 1000 }],
      ['b', { id: 'b', type: 'CLMM', tvl: 2500 }],
    ]);
    const point = normalizeRaydiumQuote(data, market, 100, new Date(1_000), new Date(1_125), pools);
    expect(point.outputAmount.toString()).toBe('0.5');
    expect(point.effectivePrice.toString()).toBe('200');
    expect(point.pools).toHaveLength(2);
    expect(point.liquidityUsd?.toString()).toBe('3500');
    expect(point.quoteAgeMs).toBe(125);
  });

  it('rejects a mismatched output mint', () => {
    expect(() => normalizeRaydiumQuote(
      { ...data, outputMint: 'wrong' }, market, 100, new Date(0), new Date(0), new Map(),
    )).toThrow('output mint');
  });
});
