import {
  Decimal,
  EXECUTABLE_NOTIONALS_USD,
  type ExecutableNotionalUsd,
  type RoutingExecutablePriceCurve,
} from '@arbitrage-scanner/core';
import { TtlPromiseCache } from '../src/cache.js';
import { normalizeJupiterQuote } from './normalize.js';
import { SlidingWindowRateLimiter } from '../src/rate-limit.js';
import type {
  JupiterAdapterOptions,
  JupiterMarketConfig,
  JupiterQuoteResponse,
  JupiterVenueAdapter,
} from './types.js';

const DEFAULT_QUOTE_URL = 'https://api.jup.ag/swap/v1/quote';

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

export class JupiterAdapter implements JupiterVenueAdapter {
  private readonly markets: readonly JupiterMarketConfig[];
  private readonly apiKey: string;
  private readonly quoteUrl: string;
  private readonly slippageBps: number;
  private readonly restrictIntermediateTokens: boolean;
  private readonly request: NonNullable<JupiterAdapterOptions['fetch']>;
  private readonly now: () => number;
  private readonly cache: TtlPromiseCache<{
    readonly quote: JupiterQuoteResponse;
    readonly receivedAt: Date;
  }>;
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(options: JupiterAdapterOptions) {
    if (options.apiKey.trim() === '') throw new Error('Jupiter apiKey is required');
    this.markets = options.markets;
    this.apiKey = options.apiKey;
    this.quoteUrl = options.quoteUrl ?? DEFAULT_QUOTE_URL;
    this.slippageBps = positiveInteger(options.slippageBps ?? 50, 'slippageBps');
    this.restrictIntermediateTokens = options.restrictIntermediateTokens ?? true;
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    const sleep = options.sleep ?? defaultSleep;
    this.cache = new TtlPromiseCache(
      options.cacheTtlMs ?? 5_000,
      options.cacheMaxEntries ?? 1_000,
      this.now,
    );
    this.limiter = new SlidingWindowRateLimiter(
      options.rateLimitRequests ?? 10,
      options.rateLimitIntervalMs ?? 1_000,
      this.now,
      sleep,
    );
  }

  async getCurve(market: JupiterMarketConfig): Promise<RoutingExecutablePriceCurve> {
    const quotes = await Promise.all(
      EXECUTABLE_NOTIONALS_USD.map(async (notionalUsd) => {
        const response = await this.getQuote(market, notionalUsd);
        return normalizeJupiterQuote(response.quote, market, notionalUsd, response.receivedAt);
      }),
    );
    const observedAt = quotes.reduce(
      (latest, quote) => quote.quoteTimestamp > latest ? quote.quoteTimestamp : latest,
      quotes[0]?.quoteTimestamp ?? new Date(this.now()),
    );
    return {
      kind: 'routing',
      marketId: `jupiter:${market.inputToken.symbol}-${market.outputToken.symbol}`,
      observedAt,
      inputAsset: market.inputToken,
      outputAsset: market.outputToken,
      quotes,
    };
  }

  getConfiguredCurves(): Promise<readonly RoutingExecutablePriceCurve[]> {
    return Promise.all(this.markets.map((market) => this.getCurve(market)));
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async getQuote(
    market: JupiterMarketConfig,
    notionalUsd: ExecutableNotionalUsd,
  ): Promise<{ readonly quote: JupiterQuoteResponse; readonly receivedAt: Date }> {
    const amount = new Decimal(notionalUsd).mul(new Decimal(10).pow(market.inputToken.decimals));
    if (!amount.isInteger()) throw new RangeError('USD notional cannot be represented in input token atomic units');
    const key = [market.inputToken.contractAddress, market.outputToken.contractAddress, amount.toFixed(0), this.slippageBps].join(':');
    return this.cache.getOrCreate(key, async () => {
      await this.limiter.acquire();
      const url = new URL(this.quoteUrl);
      url.searchParams.set('inputMint', market.inputToken.contractAddress);
      url.searchParams.set('outputMint', market.outputToken.contractAddress);
      url.searchParams.set('amount', amount.toFixed(0));
      url.searchParams.set('swapMode', 'ExactIn');
      url.searchParams.set('slippageBps', String(this.slippageBps));
      url.searchParams.set('restrictIntermediateTokens', String(this.restrictIntermediateTokens));
      const response = await this.request(url, { headers: { 'x-api-key': this.apiKey } });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        throw new Error(`Jupiter quote failed: HTTP ${response.status}${body === '' ? '' : `: ${body}`}`);
      }
      const quote = await response.json() as JupiterQuoteResponse;
      return { quote, receivedAt: new Date(this.now()) };
    });
  }
}
