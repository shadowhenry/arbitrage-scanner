import { EXECUTABLE_NOTIONALS_USD } from '@arbitrage-scanner/core';
import { describe, expect, it, vi } from 'vitest';
import { JupiterAdapter } from './client.js';
import type { JupiterFetch, JupiterMarketConfig, JupiterQuoteResponse } from './types.js';

const USDC = {
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  network: 'solana',
  contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
} as const;
const SOL = {
  symbol: 'SOL',
  name: 'Wrapped SOL',
  decimals: 9,
  network: 'solana',
  contractAddress: 'So11111111111111111111111111111111111111112',
} as const;
const MARKET: JupiterMarketConfig = { inputToken: USDC, outputToken: SOL };

function quote(amount: string): JupiterQuoteResponse {
  return {
    inputMint: USDC.contractAddress,
    inAmount: amount,
    outputMint: SOL.contractAddress,
    outAmount: String(BigInt(amount) * 10n),
    otherAmountThreshold: String(BigInt(amount) * 9n),
    swapMode: 'ExactIn',
    slippageBps: 50,
    priceImpactPct: '0.00125',
    routePlan: [
      {
        swapInfo: {
          ammKey: 'amm-1',
          label: 'Raydium CLMM',
          inputMint: USDC.contractAddress,
          outputMint: SOL.contractAddress,
          inAmount: amount,
          outAmount: String(BigInt(amount) * 10n),
          feeAmount: '42',
          feeMint: USDC.contractAddress,
        },
        percent: 100,
      },
      {
        swapInfo: {
          ammKey: 'amm-2',
          label: 'Raydium CLMM',
          inputMint: USDC.contractAddress,
          outputMint: SOL.contractAddress,
          inAmount: amount,
          outAmount: String(BigInt(amount) * 10n),
        },
        bps: 2500,
      },
    ],
    contextSlot: 123456,
  };
}

function quoteFetch(urls: URL[]): JupiterFetch {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    urls.push(url);
    return new Response(JSON.stringify(quote(url.searchParams.get('amount') ?? '0')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('JupiterAdapter', () => {
  it('builds a routing curve for every configured USD notional', async () => {
    const urls: URL[] = [];
    const adapter = new JupiterAdapter({
      markets: [MARKET],
      apiKey: 'test-key',
      fetch: quoteFetch(urls),
      now: () => Date.parse('2026-01-02T03:04:05.000Z'),
    });

    const curve = await adapter.getCurve(MARKET);

    expect(curve.kind).toBe('routing');
    expect(curve.quotes.map((point) => point.notionalUsd)).toEqual(EXECUTABLE_NOTIONALS_USD);
    expect(urls.map((url) => url.searchParams.get('amount'))).toEqual([
      '100000000', '500000000', '1000000000', '2500000000',
      '5000000000', '10000000000', '25000000000',
    ]);
    expect(urls.every((url) => url.searchParams.get('swapMode') === 'ExactIn')).toBe(true);
    expect(curve.quotes[0]?.inputAmount.toString()).toBe('100');
    expect(curve.quotes[0]?.outputAmount.toString()).toBe('1');
    expect(curve.quotes[0]?.effectivePrice.toString()).toBe('100');
    expect(curve.quotes[0]?.priceImpact.toString()).toBe('0.00125');
    expect(curve.quotes[0]?.dexLabels).toEqual(['Raydium CLMM']);
    expect(curve.quotes[0]?.route[1]?.percent.toString()).toBe('25');
    expect(curve.quotes[0]?.quoteTimestamp.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('caches completed quotes and coalesces concurrent requests', async () => {
    const urls: URL[] = [];
    const adapter = new JupiterAdapter({
      markets: [MARKET], apiKey: 'test-key', fetch: quoteFetch(urls), cacheTtlMs: 10_000,
    });

    const [first, second] = await Promise.all([adapter.getCurve(MARKET), adapter.getCurve(MARKET)]);
    await adapter.getCurve(MARKET);

    expect(urls).toHaveLength(7);
    expect(first.quotes[0]?.quoteTimestamp).toEqual(second.quotes[0]?.quoteTimestamp);
  });

  it('applies the configured sliding-window request limit', async () => {
    const urls: URL[] = [];
    let now = 0;
    const sleeps: number[] = [];
    const adapter = new JupiterAdapter({
      markets: [MARKET],
      apiKey: 'test-key',
      fetch: quoteFetch(urls),
      rateLimitRequests: 2,
      rateLimitIntervalMs: 1_000,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });

    await adapter.getCurve(MARKET);

    expect(urls).toHaveLength(7);
    expect(sleeps).toEqual([1_000, 1_000, 1_000]);
  });

  it('rejects missing credentials without ever making a request', () => {
    expect(() => new JupiterAdapter({ markets: [MARKET], apiKey: '' })).toThrow('apiKey');
  });
});
