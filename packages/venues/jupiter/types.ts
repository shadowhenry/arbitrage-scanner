import type { Asset, ExecutablePriceCurve } from '@arbitrage-scanner/core';

export const JUPITER_VENUE = {
  id: 'jupiter',
  name: 'Jupiter',
  kind: 'dex',
} as const;

export interface JupiterToken extends Asset {
  readonly decimals: number;
  readonly contractAddress: string;
  readonly network: 'solana';
}

export interface JupiterMarketConfig {
  /** Normally a USD stablecoin such as USDC. */
  readonly inputToken: JupiterToken;
  readonly outputToken: JupiterToken;
}

/** Common Solana tokens queried through Jupiter routing. */
export const JUPITER_TOKENS = {
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

export const JUPITER_MARKETS = [
  { inputToken: JUPITER_TOKENS.USDC, outputToken: JUPITER_TOKENS.SOL },
  { inputToken: JUPITER_TOKENS.USDC, outputToken: JUPITER_TOKENS.WIF },
  { inputToken: JUPITER_TOKENS.USDC, outputToken: JUPITER_TOKENS.BONK },
] as const satisfies readonly JupiterMarketConfig[];

export interface JupiterSwapInfoResponse {
  readonly ammKey: string;
  readonly label: string;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inAmount: string;
  readonly outAmount: string;
  readonly feeAmount?: string;
  readonly feeMint?: string;
}

export interface JupiterRoutePlanResponse {
  readonly swapInfo: JupiterSwapInfoResponse;
  readonly percent?: number;
  readonly bps?: number;
}

export interface JupiterQuoteResponse {
  readonly inputMint: string;
  readonly inAmount: string;
  readonly outputMint: string;
  readonly outAmount: string;
  readonly otherAmountThreshold: string;
  readonly swapMode: 'ExactIn' | 'ExactOut';
  readonly slippageBps: number;
  readonly priceImpactPct: string;
  readonly routePlan: readonly JupiterRoutePlanResponse[];
  readonly contextSlot?: number;
  readonly timeTaken?: number;
}

export type JupiterFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface JupiterAdapterOptions {
  readonly markets: readonly JupiterMarketConfig[];
  readonly apiKey: string;
  readonly quoteUrl?: string;
  readonly slippageBps?: number;
  readonly restrictIntermediateTokens?: boolean;
  readonly cacheTtlMs?: number;
  readonly cacheMaxEntries?: number;
  readonly rateLimitRequests?: number;
  readonly rateLimitIntervalMs?: number;
  readonly fetch?: JupiterFetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface JupiterVenueAdapter {
  getCurve(market: JupiterMarketConfig): Promise<ExecutablePriceCurve>;
  getConfiguredCurves(): Promise<readonly ExecutablePriceCurve[]>;
  clearCache(): void;
}
