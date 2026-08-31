import type { RoutingExecutablePriceCurve } from '@arbitrage-scanner/core';
import type { JupiterMarketConfig, JupiterToken } from '../jupiter/types.js';

export const RAYDIUM_VENUE = { id: 'raydium', name: 'Raydium', kind: 'dex' } as const;

export const RAYDIUM_TOKENS = {
  USDC: {
    symbol: 'USDC', name: 'USD Coin', decimals: 6, network: 'solana',
    contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  SOL: {
    symbol: 'SOL', name: 'Wrapped SOL', decimals: 9, network: 'solana',
    contractAddress: 'So11111111111111111111111111111111111111112',
  },
  WIF: {
    symbol: 'WIF', name: 'dogwifhat', decimals: 6, network: 'solana',
    contractAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  },
  BONK: {
    symbol: 'BONK', name: 'Bonk', decimals: 5, network: 'solana',
    contractAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6ekUvRrWv1pPB263',
  },
} as const satisfies Record<string, JupiterToken>;

export const RAYDIUM_MARKETS = [
  { inputToken: RAYDIUM_TOKENS.USDC, outputToken: RAYDIUM_TOKENS.SOL },
  { inputToken: RAYDIUM_TOKENS.USDC, outputToken: RAYDIUM_TOKENS.WIF },
  { inputToken: RAYDIUM_TOKENS.USDC, outputToken: RAYDIUM_TOKENS.BONK },
] as const satisfies readonly JupiterMarketConfig[];

export interface RaydiumRoutePlanResponse {
  readonly poolId: string;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly feeAmount?: string;
  readonly feeMint?: string;
  readonly inputAmount?: string;
  readonly outputAmount?: string;
}

export interface RaydiumQuoteData {
  readonly swapType: 'BaseIn';
  readonly inputMint: string;
  readonly inputAmount: string;
  readonly outputMint: string;
  readonly outputAmount: string;
  readonly otherAmountThreshold: string;
  readonly slippageBps: number;
  readonly priceImpactPct: number | string;
  readonly routePlan: readonly RaydiumRoutePlanResponse[];
}

export interface RaydiumQuoteResponse {
  readonly id: string;
  readonly success: boolean;
  readonly version: string;
  readonly msg?: string;
  readonly data: RaydiumQuoteData;
}

export interface RaydiumPoolInfo {
  readonly id: string;
  readonly type: string;
  readonly tvl: number;
}

export interface RaydiumPoolInfoResponse {
  readonly id: string;
  readonly success: boolean;
  readonly msg?: string;
  readonly data: readonly RaydiumPoolInfo[];
}

export type RaydiumFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RaydiumAdapterOptions {
  readonly markets?: readonly JupiterMarketConfig[];
  readonly quoteUrl?: string;
  readonly poolInfoUrl?: string;
  readonly slippageBps?: number;
  readonly cacheTtlMs?: number;
  readonly cacheMaxEntries?: number;
  readonly rateLimitRequests?: number;
  readonly rateLimitIntervalMs?: number;
  readonly fetch?: RaydiumFetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface RaydiumVenueAdapter {
  getCurve(market: JupiterMarketConfig): Promise<RoutingExecutablePriceCurve>;
  getConfiguredCurves(): Promise<readonly RoutingExecutablePriceCurve[]>;
  clearCache(): void;
}
