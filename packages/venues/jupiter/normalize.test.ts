import { describe, expect, it } from 'vitest';
import { normalizeJupiterQuote } from './normalize.js';
import type { JupiterMarketConfig, JupiterQuoteResponse } from './types.js';

const market: JupiterMarketConfig = {
  inputToken: { symbol: 'USDC', decimals: 6, network: 'solana', contractAddress: 'usdc' },
  outputToken: { symbol: 'TOKEN', decimals: 8, network: 'solana', contractAddress: 'token' },
};

const response: JupiterQuoteResponse = {
  inputMint: 'usdc', inAmount: '100000000', outputMint: 'token', outAmount: '250000000',
  otherAmountThreshold: '247500000', swapMode: 'ExactIn', slippageBps: 100,
  priceImpactPct: '0.002', routePlan: [{
    swapInfo: {
      ammKey: 'pool', label: 'Orca Whirlpool', inputMint: 'usdc', outputMint: 'token',
      inAmount: '100000000', outAmount: '250000000',
    },
    percent: 100,
  }],
};

describe('normalizeJupiterQuote', () => {
  it('uses decimal-safe token units and preserves the auditable route', () => {
    const point = normalizeJupiterQuote(response, market, 100, new Date(0));
    expect(point.inputAmount.toString()).toBe('100');
    expect(point.outputAmount.toString()).toBe('2.5');
    expect(point.effectivePrice.toString()).toBe('40');
    expect(point.route[0]?.inputAmountAtomic).toBe('100000000');
  });

  it('rejects mismatched mints and zero output', () => {
    expect(() => normalizeJupiterQuote({ ...response, outputMint: 'wrong' }, market, 100, new Date(0)))
      .toThrow('output mint');
    expect(() => normalizeJupiterQuote({ ...response, outAmount: '0' }, market, 100, new Date(0)))
      .toThrow('positive');
  });
});
