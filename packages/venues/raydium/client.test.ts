import { EXECUTABLE_NOTIONALS_USD } from '@arbitrage-scanner/core';
import { describe, expect, it, vi } from 'vitest';
import { RaydiumAdapter } from './client.js';
import {
  RAYDIUM_MARKETS,
  RAYDIUM_TOKENS,
  type RaydiumFetch,
  type RaydiumQuoteResponse,
} from './types.js';

function quote(amount: string): RaydiumQuoteResponse {
  return {
    id: 'quote-id', success: true, version: 'V1', data: {
      swapType: 'BaseIn', inputMint: RAYDIUM_TOKENS.USDC.contractAddress,
      inputAmount: amount, outputMint: RAYDIUM_TOKENS.SOL.contractAddress,
      outputAmount: String(BigInt(amount) * 10n), otherAmountThreshold: amount,
      slippageBps: 50, priceImpactPct: 0.001,
      routePlan: [{
        poolId: 'pool-a', inputMint: RAYDIUM_TOKENS.USDC.contractAddress,
        outputMint: RAYDIUM_TOKENS.SOL.contractAddress, feeAmount: '2500',
        feeMint: RAYDIUM_TOKENS.USDC.contractAddress,
      }],
    },
  };
}

function createFetch(urls: URL[], onPoolRequest?: () => void): RaydiumFetch {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    urls.push(url);
    if (url.pathname === '/pools/info/ids') {
      onPoolRequest?.();
      return new Response(JSON.stringify({
        id: 'pool-request', success: true,
        data: [{ id: 'pool-a', type: 'Concentrated', tvl: 12_345_678.9 }],
      }));
    }
    return new Response(JSON.stringify(quote(url.searchParams.get('amount') ?? '0')));
  });
}

describe('RaydiumAdapter', () => {
  it('supports the required Phase 1 markets', () => {
    expect(RAYDIUM_MARKETS.map((market) => `${market.outputToken.symbol}/${market.inputToken.symbol}`))
      .toEqual(['SOL/USDC', 'WIF/USDC', 'BONK/USDC']);
  });

  it('generates the routing curve with pool liquidity and quote age', async () => {
    const urls: URL[] = [];
    let now = 1_000;
    const adapter = new RaydiumAdapter({
      markets: [RAYDIUM_MARKETS[0]],
      fetch: createFetch(urls, () => { now += 250; }),
      now: () => now,
    });

    const curve = await adapter.getCurve(RAYDIUM_MARKETS[0]);

    expect(curve.kind).toBe('routing');
    expect(curve.marketId).toBe('raydium:SOL-USDC');
    expect(curve.quotes.map((point) => point.notionalUsd)).toEqual(EXECUTABLE_NOTIONALS_USD);
    expect(curve.quotes[0]?.effectivePrice.toString()).toBe('100');
    expect(curve.quotes[0]?.priceImpact.toString()).toBe('0.001');
    expect(curve.quotes[0]?.pools?.[0]?.poolId).toBe('pool-a');
    expect(curve.quotes[0]?.pools?.[0]?.poolType).toBe('Concentrated');
    expect(curve.quotes[0]?.liquidityUsd?.toString()).toBe('12345678.9');
    expect(curve.quotes[0]?.quoteAgeMs).toBe(250);
    expect(urls.filter((url) => url.pathname === '/compute/swap-base-in')).toHaveLength(7);
    expect(urls.filter((url) => url.pathname === '/pools/info/ids')).toHaveLength(1);
    expect(urls.every((url) => !url.pathname.includes('/transaction/'))).toBe(true);
  });

  it('caches quotes and pool metadata', async () => {
    const urls: URL[] = [];
    const adapter = new RaydiumAdapter({
      markets: [RAYDIUM_MARKETS[0]], fetch: createFetch(urls), cacheTtlMs: 10_000,
    });
    await adapter.getCurve(RAYDIUM_MARKETS[0]);
    await adapter.getCurve(RAYDIUM_MARKETS[0]);
    expect(urls).toHaveLength(8);
  });

  it('surfaces unsuccessful quote responses', async () => {
    const request: RaydiumFetch = vi.fn(async () => new Response(JSON.stringify({
      id: 'failed', success: false, version: 'V1', msg: 'NO_ROUTE', data: {},
    })));
    const adapter = new RaydiumAdapter({ markets: [RAYDIUM_MARKETS[0]], fetch: request });
    await expect(adapter.getCurve(RAYDIUM_MARKETS[0])).rejects.toThrow('NO_ROUTE');
  });
});
