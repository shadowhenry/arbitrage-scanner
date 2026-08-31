import {
  JupiterAdapter,
  JUPITER_VENUE,
  type JupiterMarketConfig,
  type JupiterToken,
} from '@arbitrage-scanner/venues/jupiter';
import type { RoutingExecutablePriceCurve } from '@arbitrage-scanner/core';

/**
 * SOL/USDC token definitions for Jupiter routing.
 * These match the canonical Solana mainnet token addresses.
 */
export const JUPITER_TOKENS = {
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    network: 'solana',
    contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  } as const satisfies JupiterToken,
  SOL: {
    symbol: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9,
    network: 'solana',
    contractAddress: 'So11111111111111111111111111111111111111112',
  } as const satisfies JupiterToken,
} as const;

/** Bidirectional markets: USDC→SOL (buy) and SOL→USDC (sell). */
export const SOL_USDC_MARKETS: readonly JupiterMarketConfig[] = [
  { inputToken: JUPITER_TOKENS.USDC, outputToken: JUPITER_TOKENS.SOL },
  { inputToken: JUPITER_TOKENS.SOL, outputToken: JUPITER_TOKENS.USDC },
] as const;

function directionForMarket(market: JupiterMarketConfig): 'buy' | 'sell' {
  return market.inputToken.symbol === 'USDC' ? 'buy' : 'sell';
}

export interface JupiterCollectorHandle {
  readonly adapter: JupiterAdapter;
  readonly pollOnce: () => Promise<void>;
  readonly stop: () => void;
}

/**
 * Starts the Jupiter quote collector. Returns a handle if the API key is
 * configured and the collector started successfully; returns null otherwise.
 *
 * The collector polls bidirectional SOL/USDC routes at the configured
 * interval and logs normalized quotes to stdout.
 */
export function startJupiterCollector(): JupiterCollectorHandle | null {
  const apiKey = process.env.JUPITER_API_KEY ?? '';
  if (apiKey.trim() === '') {
    console.warn(JSON.stringify({
      service: 'collector:jupiter',
      warning: 'JUPITER_API_KEY not set, skipping Jupiter collector',
      timestamp: new Date().toISOString(),
    }));
    return null;
  }

  const adapter = new JupiterAdapter({
    markets: SOL_USDC_MARKETS,
    apiKey,
    slippageBps: Number(process.env.JUPITER_SLIPPAGE_BPS ?? '50'),
    cacheTtlMs: Number(process.env.JUPITER_CACHE_TTL_MS ?? '2000'),
    rateLimitRequests: Number(process.env.JUPITER_RATE_LIMIT_REQUESTS ?? '10'),
    rateLimitIntervalMs: Number(process.env.JUPITER_RATE_LIMIT_INTERVAL_MS ?? '1000'),
  });

  const pollIntervalMs = Number(process.env.JUPITER_POLL_INTERVAL_MS ?? '2000');

  async function pollOnce(): Promise<void> {
    try {
      const curves = await adapter.getConfiguredCurves();
      const timestamp = new Date().toISOString();
      for (const curve of curves) {
        const market = SOL_USDC_MARKETS.find((m) =>
          m.inputToken.contractAddress === curve.inputAsset.contractAddress
          && m.outputToken.contractAddress === curve.outputAsset.contractAddress);
        const direction = market !== undefined ? directionForMarket(market) : 'unknown';
        console.log(JSON.stringify({
          venue: JUPITER_VENUE.id,
          direction,
          marketId: curve.marketId,
          observedAt: curve.observedAt.toISOString(),
          receivedAt: timestamp,
          quotes: curve.quotes.map((quote) => ({
            notionalUsd: quote.notionalUsd,
            inputAmount: quote.inputAmount.toString(),
            outputAmount: quote.outputAmount.toString(),
            effectivePrice: quote.effectivePrice.toString(),
            priceImpact: quote.priceImpact.toString(),
            dexLabels: quote.dexLabels,
            quoteAgeMs: quote.quoteAgeMs,
            contextSlot: quote.contextSlot,
          })),
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        service: 'collector:jupiter',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
    }
  }

  const pollTimer = setInterval(() => { void pollOnce(); }, pollIntervalMs);

  function stop(): void {
    clearInterval(pollTimer);
    adapter.clearCache();
  }

  // Initial poll
  void pollOnce();

  return { adapter, pollOnce, stop };
}

// Auto-start when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const handle = startJupiterCollector();
  if (handle === null) {
    process.exit(1);
  }
  process.once('SIGINT', () => { handle.stop(); process.exitCode = 0; });
  process.once('SIGTERM', () => { handle.stop(); process.exitCode = 0; });
}

export type { RoutingExecutablePriceCurve };
